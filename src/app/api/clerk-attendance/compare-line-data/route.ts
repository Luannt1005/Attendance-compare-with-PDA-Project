import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import { parseTimeStr, getOverlapHours, extractInOut } from '@/lib/auditLogic';
import { format, addDays, differenceInMinutes } from 'date-fns';

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        
        // Helper to check if a header is a date
        function isDateHeader(h: any): boolean {
            if (typeof h === 'number' && h > 30000 && h < 60000) {
                try {
                    const dateInfo = XLSX.SSF.parse_date_code(h);
                    return !!(dateInfo && dateInfo.y >= 1990 && dateInfo.y <= 2100);
                } catch {
                    return false;
                }
            }
            if (typeof h === 'string') {
                const cleaned = h.trim();
                if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(cleaned) || 
                    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(cleaned) ||
                    /^\d{1,2}[\/\-]\d{1,2}$/.test(cleaned) ||
                    /^\d{1,2}[\/\-][a-zA-Z]{3}[\/\-]\d{2,4}$/.test(cleaned) ||
                    /^\d{1,2}[\/\-][a-zA-Z]{3}$/.test(cleaned)) {
                    return true;
                }
            }
            return false;
        }

        interface ShiftAssignment {
            empCode: string;
            fullName: string;
            leader: string;
            dateStr: string;
            dateObj: Date;
            shiftCode: string;
        }

        const shiftAssignments: ShiftAssignment[] = [];
        const employeeCodesSet = new Set<string>();
        const codeToNameMap = new Map<string, string>();

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[];
            if (rawData.length < 2) continue;

            const headers = rawData[0];
            
            // Find where date columns start
            let firstDateIndex = -1;
            for (let i = 2; i < headers.length; i++) {
                if (isDateHeader(headers[i])) {
                    firstDateIndex = i;
                    break;
                }
            }
            if (firstDateIndex === -1) continue;

            // Extract dates
            const dateCols: { index: number, dateStr: string, dateObj: Date }[] = [];
            for (let i = firstDateIndex; i < headers.length; i++) {
                const h = headers[i];
                let d: Date | null = null;
                if (typeof h === 'number') {
                    const dateInfo = XLSX.SSF.parse_date_code(h);
                    d = new Date(dateInfo.y, dateInfo.m - 1, dateInfo.d);
                } else if (typeof h === 'string') {
                    const cleaned = h.trim();
                    
                    if (/^\d{1,2}[\/\-][a-zA-Z]{3}([\/\-]\d{2,4})?$/.test(cleaned)) {
                        d = new Date(cleaned);
                    } else {
                        const parts = cleaned.split(/[\/\-]/);
                        if (parts.length === 3) {
                            if (parts[0].length === 4) {
                                d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                            } else if (parts[2].length === 4) {
                                d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                            } else {
                                let y = parseInt(parts[2]);
                                y = y < 100 ? 2000 + y : y;
                                d = new Date(y, parseInt(parts[1]) - 1, parseInt(parts[0]));
                            }
                        } else if (parts.length === 2) {
                            d = new Date(new Date().getFullYear(), parseInt(parts[1]) - 1, parseInt(parts[0]));
                        }
                    }
                }
                if (d && !isNaN(d.getTime())) {
                    const dateStr = format(d, 'yyyy-MM-dd');
                    dateCols.push({ index: i, dateStr, dateObj: d });
                }
            }

            if (dateCols.length === 0) continue;

            const employeeRows = rawData.slice(1);
            for (const row of employeeRows) {
                const empCode = String(row[0] || '').trim().replace(/^0+/, '');
                if (!empCode) continue;

                employeeCodesSet.add(empCode);
                const name = row[1] ? String(row[1]).trim() : 'Unknown Employee';
                if (name && name !== 'Unknown Employee' && name !== 'Unknown') {
                    codeToNameMap.set(empCode, name);
                }

                const leader = (firstDateIndex > 2 && row[2]) ? String(row[2]).trim() : 'N/A';

                for (const col of dateCols) {
                    const shiftCodeRaw = row[col.index];
                    const shiftCode = shiftCodeRaw ? String(shiftCodeRaw).trim().toUpperCase() : '';
                    
                    shiftAssignments.push({
                        empCode,
                        fullName: name,
                        leader,
                        dateStr: col.dateStr,
                        dateObj: col.dateObj,
                        shiftCode
                    });
                }
            }
        }

        if (shiftAssignments.length === 0) {
            return NextResponse.json({ error: 'No valid date headers found. Check your template.' }, { status: 400 });
        }

        const allDates = Array.from(new Set(shiftAssignments.map(s => s.dateStr))).sort();
        const minDate = new Date(allDates[0]);
        const maxDate = new Date(allDates[allDates.length - 1]);
        const fpMaxDate = addDays(maxDate, 1);

        const employeeCodes = Array.from(employeeCodesSet);

        // Pre-fetch all necessary data from DB
        const shifts = await prisma.shift.findMany();
        const shiftMap = new Map();
        for (const s of shifts) shiftMap.set(s.code.trim().toUpperCase(), s);

        // Auto-create missing employees so NOTHING is skipped
        const existingEmployees = await prisma.employee.findMany({
            where: { employeeCode: { in: employeeCodes } }
        });
        const existingCodes = new Set(existingEmployees.map(e => e.employeeCode));
        const missingCodes = Array.from(new Set(employeeCodes.filter(code => !existingCodes.has(code))));

        if (missingCodes.length > 0) {
            let dummyDept = await prisma.department.findUnique({ where: { name: 'Unknown Department' } });
            if (!dummyDept) {
                dummyDept = await prisma.department.create({ data: { name: 'Unknown Department' } });
            }

            let dummyLine = await prisma.line.findFirst({ where: { departmentId: dummyDept.id, name: 'Unknown Line' } });
            if (!dummyLine) {
                dummyLine = await prisma.line.create({ data: { departmentId: dummyDept.id, name: 'Unknown Line' } });
            }

            await prisma.$transaction(
                missingCodes.map(code => prisma.employee.create({
                    data: {
                        employeeCode: code,
                        fullName: codeToNameMap.get(code) || 'Unknown Employee',
                        departmentId: dummyDept.id,
                        lineId: dummyLine.id,
                        joinDate: new Date(),
                        status: 'Active'
                    }
                }))
            );
        }

        // Auto-update existing employees who have 'Unknown Employee' or 'Unknown' as full name
        const empsToUpdate = existingEmployees.filter(e => e.fullName === 'Unknown Employee' || e.fullName === 'Unknown');
        if (empsToUpdate.length > 0) {
            const updateOps = empsToUpdate.map(e => {
                const newName = codeToNameMap.get(e.employeeCode);
                if (newName && newName !== 'Unknown Employee' && newName !== 'Unknown') {
                    return prisma.employee.update({
                        where: { id: e.id },
                        data: { fullName: newName }
                    });
                }
                return null;
            }).filter(Boolean) as any[];

            if (updateOps.length > 0) {
                await prisma.$transaction(updateOps);
            }
        }

        const employees = await prisma.employee.findMany({
            where: { employeeCode: { in: employeeCodes } }
        });
        const empMap = new Map();
        for (const e of employees) empMap.set(e.employeeCode, e);

        const lineDataRecords = await prisma.lineData.findMany({
            where: {
                employeeId: { in: employees.map(e => e.id) },
                recordDate: { gte: minDate, lte: maxDate }
            }
        });

        const fingerprints = await prisma.fingerprint.findMany({
            where: {
                employeeId: { in: employees.map(e => e.id) },
                recordDate: { gte: minDate, lte: fpMaxDate }
            }
        });

        // Helper function for OT calculation
        function calcOT(inStr: string | null, outStr: string | null, shiftCode: string, dateObj: Date) {
            if (!inStr || !outStr || !shiftCode) return 0;
            const conf = shiftMap.get(shiftCode);
            if (!conf) return 0;
            
            let expectedOt = 0;
            let actIn = parseTimeStr(inStr, dateObj);
            let actOut = parseTimeStr(outStr, dateObj);

            let reqIn = parseTimeStr(conf.startTime, dateObj);
            let reqOut = parseTimeStr(conf.endTime, dateObj);
            const isNightShift = reqOut < reqIn;
            
            if (isNightShift) {
                reqOut = addDays(reqOut, 1);
                if (actIn.getHours() < 15) actIn = addDays(actIn, 1);
                if (actOut.getHours() < 15) actOut = addDays(actOut, 1);
            }
            if (actOut < actIn) actOut = addDays(actOut, 1);

            if (conf.otPreStart && conf.otPreEnd) {
                let preStart = parseTimeStr(conf.otPreStart, dateObj);
                let preEnd = parseTimeStr(conf.otPreEnd, dateObj);
                if (preEnd < preStart) preEnd = addDays(preEnd, 1);
                expectedOt += getOverlapHours(actIn, actOut, preStart, preEnd);
            }

            if (conf.otPostStart && conf.otPostEnd) {
                let postStart = parseTimeStr(conf.otPostStart, dateObj);
                let postEnd = parseTimeStr(conf.otPostEnd, dateObj);
                if (postEnd < postStart) postEnd = addDays(postEnd, 1);
                if (isNightShift && postStart.getHours() < 15) {
                    postStart = addDays(postStart, 1);
                    postEnd = addDays(postEnd, 1);
                }
                expectedOt += getOverlapHours(actIn, actOut, postStart, postEnd);
            }
            return expectedOt;
        }

        // Helper to find the earliest check-in and latest check-out chronologically
        function getEarliestLatestLine(empLds: { lineIn: string | null, lineOut: string | null }[], isNight: boolean, dateObj: Date) {
            if (empLds.length === 0) return { lineIn: null, lineOut: null };

            let earliestInTime: Date | null = null;
            let earliestInStr: string | null = null;

            let latestOutTime: Date | null = null;
            let latestOutStr: string | null = null;

            for (const ld of empLds) {
                if (ld.lineIn) {
                    let inTime = parseTimeStr(ld.lineIn, dateObj);
                    if (isNight && inTime.getHours() < 15) {
                        inTime = addDays(inTime, 1);
                    }
                    if (!earliestInTime || inTime < earliestInTime) {
                        earliestInTime = inTime;
                        earliestInStr = ld.lineIn;
                    }
                }
                if (ld.lineOut) {
                    let outTime = parseTimeStr(ld.lineOut, dateObj);
                    if (isNight && outTime.getHours() < 15) {
                        outTime = addDays(outTime, 1);
                    }
                    if (!latestOutTime || outTime > latestOutTime) {
                        latestOutTime = outTime;
                        latestOutStr = ld.lineOut;
                    }
                }
            }

            return { lineIn: earliestInStr, lineOut: latestOutStr };
        }

        const results = [];

        for (const assignment of shiftAssignments) {
            const emp = empMap.get(assignment.empCode);
            if (!emp) continue;

            const { empCode, dateStr, dateObj, shiftCode, leader } = assignment;

            const empLds = lineDataRecords.filter(l => l.employeeId === emp.id && format(l.recordDate, 'yyyy-MM-dd') === dateStr);
            const fpToday = fingerprints.find(f => f.employeeId === emp.id && format(f.recordDate, 'yyyy-MM-dd') === dateStr);
            const fpNext = fingerprints.find(f => f.employeeId === emp.id && format(f.recordDate, 'yyyy-MM-dd') === format(addDays(dateObj, 1), 'yyyy-MM-dd'));

            const shiftConf = shiftMap.get(shiftCode);

            const joiningDate = emp.joinDate ? format(emp.joinDate, 'yyyy-MM-dd') : '';
            const lwd = emp.resignDate ? format(emp.resignDate, 'yyyy-MM-dd') : '';
            const lineLeader = leader !== 'N/A' ? leader : '';
            const shiftLeaderVal = emp.shiftLeader || '';
            const supervisorVal = emp.supervisor || '';
            const mgtVal = emp.mgt || '';

            if (shiftConf && shiftConf.isLeave) {
                results.push({
                    employeeCode: empCode,
                    fullName: emp.fullName,
                    leader: leader,
                    date: dateStr,
                    shift: shiftCode,
                    fpIn: 'N/A',
                    fpOut: 'N/A',
                    lineIn: 'N/A',
                    lineOut: 'N/A',
                    otFp: 0,
                    otLine: 0,
                    diff: 0,
                    varCheckIn: 'N/A',
                    varCheckOut: 'N/A',
                    reason: 'Nghỉ phép',
                    status: 'VALID',
                    joiningDate,
                    lwd,
                    lineLeader,
                    shiftLeader: shiftLeaderVal,
                    supervisor: supervisorVal,
                    mgt: mgtVal
                });
                continue;
            }
            const isNight = shiftConf && parseTimeStr(shiftConf.endTime, dateObj) < parseTimeStr(shiftConf.startTime, dateObj);
            
            let fpIn = null;
            let fpOut = null;
            
            if (fpToday) {
                const parsed = extractInOut(fpToday.timeString);
                fpIn = parsed.inTime;
                if (!isNight) {
                    fpOut = parsed.outTime;
                }
            }
            if (isNight) {
                if (fpNext) {
                    const parsedNext = extractInOut(fpNext.timeString);
                    if (parsedNext.outTime && parsedNext.outTime < '15:00') {
                        fpOut = parsedNext.outTime;
                    } else if (parsedNext.inTime && parsedNext.inTime < '15:00') {
                        fpOut = parsedNext.inTime;
                    }
                }
                if (!fpOut && fpToday) {
                    const parsedToday = extractInOut(fpToday.timeString);
                    if (parsedToday.outTime && parsedToday.outTime >= '14:00' && parsedToday.outTime !== fpIn) {
                        fpOut = parsedToday.outTime;
                    }
                }
            }

            // Aggregate multiple line records to earliest check-in and latest check-out
            const isNightShift = shiftConf && parseTimeStr(shiftConf.endTime, dateObj) < parseTimeStr(shiftConf.startTime, dateObj);
            const aggregatedLine = getEarliestLatestLine(empLds, !!isNightShift, dateObj);

            const lineInStr = aggregatedLine.lineIn || 'N/A';
            const lineOutStr = aggregatedLine.lineOut || 'N/A';

            let otFp = calcOT(fpIn, fpOut, shiftCode, dateObj);
            if (otFp < 0.5) {
                otFp = 0;
            }
            let otLine = calcOT(aggregatedLine.lineIn, aggregatedLine.lineOut, shiftCode, dateObj);
            if (otLine < 0.5) {
                otLine = 0;
            }
            
            const diff = otFp - otLine;
            
            let varCheckIn = 'N/A';
            let hasCheckInDeviation = false;
            let absCheckInDev: number | null = null;
            if (aggregatedLine.lineIn && shiftConf && shiftConf.startTime) {
                let lineInTime = parseTimeStr(aggregatedLine.lineIn, dateObj);
                let shiftStartTime = parseTimeStr(shiftConf.startTime, dateObj);
                if (isNightShift) {
                    if (lineInTime.getHours() < 15) lineInTime = addDays(lineInTime, 1);
                    if (shiftStartTime.getHours() < 15) shiftStartTime = addDays(shiftStartTime, 1);
                }
                const diffMins = differenceInMinutes(lineInTime, shiftStartTime);
                absCheckInDev = Math.abs(diffMins);
                varCheckIn = diffMins > 0 ? `+${diffMins}m` : `${diffMins}m`;
                if (diffMins > 15) {
                    hasCheckInDeviation = true;
                }
            }

            let varCheckOut = 'N/A';
            let hasCheckOutDeviation = false;
            let absCheckOutDev: number | null = null;
            if (aggregatedLine.lineOut && shiftConf && shiftConf.endTime) {
                let lineOutTime = parseTimeStr(aggregatedLine.lineOut, dateObj);
                let shiftEndTime = parseTimeStr(shiftConf.endTime, dateObj);
                let shiftStartTime = shiftConf.startTime ? parseTimeStr(shiftConf.startTime, dateObj) : null;
                
                if (isNightShift) {
                    shiftEndTime = addDays(shiftEndTime, 1);
                    if (lineOutTime.getHours() < 15) {
                        lineOutTime = addDays(lineOutTime, 1);
                    }
                }
                
                if (shiftStartTime && lineOutTime < shiftStartTime) {
                    lineOutTime = addDays(lineOutTime, 1);
                }
                
                const diffMinsOut = differenceInMinutes(lineOutTime, shiftEndTime);
                absCheckOutDev = Math.abs(diffMinsOut);
                varCheckOut = diffMinsOut > 0 ? `+${diffMinsOut}m` : `${diffMinsOut}m`;
                if (diffMinsOut < -15) {
                    hasCheckOutDeviation = true;
                }
            }

            let isPdaWrong = false;
            if (aggregatedLine.lineIn && fpIn && aggregatedLine.lineOut && fpOut) {
                let lineInTime = parseTimeStr(aggregatedLine.lineIn, dateObj);
                let fpInTime = parseTimeStr(fpIn, dateObj);
                let lineOutTime = parseTimeStr(aggregatedLine.lineOut, dateObj);
                let fpOutTime = parseTimeStr(fpOut, dateObj);

                if (isNightShift) {
                    if (lineInTime.getHours() < 15) lineInTime = addDays(lineInTime, 1);
                    if (fpInTime.getHours() < 15) fpInTime = addDays(fpInTime, 1);
                    if (lineOutTime.getHours() < 15) lineOutTime = addDays(lineOutTime, 1);
                    if (fpOutTime.getHours() < 15) fpOutTime = addDays(fpOutTime, 1);
                }

                if (lineOutTime < lineInTime) lineOutTime = addDays(lineOutTime, 1);
                if (fpOutTime < fpInTime) fpOutTime = addDays(fpOutTime, 1);

                const diffIn = Math.abs(differenceInMinutes(lineInTime, fpInTime));
                const diffOut = Math.abs(differenceInMinutes(lineOutTime, fpOutTime));

                if (diffIn + diffOut > 400) {
                    isPdaWrong = true;
                }
            }

            let isWrongShift = false;

            if (shiftConf) {
                if (!isNightShift) {
                    // Ca sáng
                    const isFpNightIn = fpIn && fpIn >= '17:00';
                    const isLineNightIn = aggregatedLine.lineIn && aggregatedLine.lineIn >= '17:00';
                    if (isFpNightIn && isLineNightIn) {
                        isWrongShift = true;
                    }
                } else {
                    // Ca đêm
                    const isFpDayIn = fpIn && fpIn >= '05:00' && fpIn < '17:00';
                    const isLineDayIn = aggregatedLine.lineIn && aggregatedLine.lineIn >= '05:00' && aggregatedLine.lineIn < '17:00';
                    if (isFpDayIn && isLineDayIn) {
                        isWrongShift = true;
                    }
                }
            }

            let reason = '';
            if (shiftCode === '') {
                if (!fpIn && !fpOut && (empLds.length === 0 || (!aggregatedLine.lineIn && !aggregatedLine.lineOut))) {
                    reason = 'Không đăng kí ca và không đi làm';
                } else {
                    reason = 'Đi làm nhưng không đăng kí ca';
                }
            } else if (!shiftConf) {
                reason = 'Ca không có trên hệ thống';
            } else if (!fpIn && !fpOut && (empLds.length === 0 || (!aggregatedLine.lineIn && !aggregatedLine.lineOut))) {
                reason = 'Không đi làm nhưng có đăng kí ca';
            } else if (!fpIn || !fpOut) {
                reason = 'Thiếu vân tay IN/OUT';
            } else if (isPdaWrong) {
                reason = 'PDA sai';
            } else if (isWrongShift) {
                reason = 'Sai ca';
            } else if (empLds.length === 0 || lineInStr === 'N/A' || lineOutStr === 'N/A') {
                if (diff !== 0) {
                    reason = 'Thiếu dữ liệu Line IN/OUT không xác định được OT';
                } else {
                    reason = 'Thiếu dữ liệu Line IN/OUT';
                }
            } else if (diff > 0) {
                reason = `Lệch: OT Vân tay lớn hơn OT Line`;
            } else if (diff < 0) {
                reason = `Lệch: OT Line lớn hơn OT Vân tay`;
            } else if (hasCheckInDeviation) {
                reason = 'Checkin line trễ';
            } else if (hasCheckOutDeviation) {
                reason = 'Check out line sớm';
            } else {
                reason = 'Hợp lệ';
            }
            
            // Do not skip empty rows so the import count matches the file exactly

            let status: 'VALID' | 'VERIFY NEEDED' | 'REMINDER' = 'VALID';
            if (
                reason === 'Thiếu dữ liệu Line IN/OUT' || 
                reason === 'Không đi làm nhưng có đăng kí ca' ||
                reason === 'Checkin line trễ' ||
                reason === 'Check out line sớm' ||
                reason === 'Lệch: OT Line lớn hơn OT Vân tay'
            ) {
                status = 'REMINDER';
            }
            if (
                reason === 'Thiếu vân tay IN/OUT' || 
                reason === 'Ca không có trên hệ thống' || 
                reason === 'Đi làm nhưng không đăng kí ca' ||
                reason === 'Sai ca' ||
                reason === 'PDA sai' ||
                reason === 'Thiếu dữ liệu Line IN/OUT không xác định được OT' ||
                (diff !== 0 && reason !== 'Thiếu dữ liệu Line IN/OUT' && reason !== 'Thiếu dữ liệu Line IN/OUT không xác định được OT' && reason !== 'Lệch: OT Line lớn hơn OT Vân tay' && reason !== 'Sai ca' && reason !== 'PDA sai')
            ) {
                status = 'VERIFY NEEDED';
            }

            results.push({
                employeeCode: empCode,
                fullName: emp.fullName,
                leader: leader,
                date: dateStr,
                shift: shiftCode,
                fpIn: fpIn || 'N/A',
                fpOut: fpOut || 'N/A',
                lineIn: lineInStr,
                lineOut: lineOutStr,
                otFp,
                otLine,
                diff,
                varCheckIn,
                varCheckOut,
                reason,
                status,
                joiningDate,
                lwd,
                lineLeader,
                shiftLeader: shiftLeaderVal,
                supervisor: supervisorVal,
                mgt: mgtVal
            });
        }

        return NextResponse.json({ 
            data: results,
            totalDiscrepancies: results.filter(r => r.status === 'VERIFY NEEDED').length,
            totalReminders: results.filter(r => r.status === 'REMINDER').length,
            totalRecords: results.length
        });

    } catch (e: any) {
        console.error('OT Comparison API Error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const dateParam = url.searchParams.get('date');
        
        if (!dateParam) {
            return NextResponse.json({ error: 'Missing date parameter' }, { status: 400 });
        }

        const targetDate = new Date(dateParam);

        const lineDataRecords = await prisma.lineData.findMany({
            where: {
                recordDate: targetDate
            },
            include: {
                employee: true
            }
        });

        if (lineDataRecords.length === 0) {
            return NextResponse.json({ data: [], totalDiscrepancies: 0, totalRecords: 0 });
        }

        const results = lineDataRecords.map(lineData => ({
            employeeCode: lineData.employee.employeeCode,
            fullName: lineData.employee.fullName,
            leader: lineData.employee.shiftLeader || 'N/A',
            date: dateParam,
            lineIn: lineData.lineIn || 'N/A',
            lineOut: lineData.lineOut || 'N/A',
            shift: lineData.shift || 'N/A',
            line: lineData.line || 'N/A'
        }));

        return NextResponse.json({ 
            data: results,
            totalDiscrepancies: 0,
            totalRecords: results.length
        });

    } catch (e: any) {
        console.error('Line Data GET API Error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
