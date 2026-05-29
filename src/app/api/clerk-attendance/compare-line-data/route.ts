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
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[];

        if (rawData.length < 2) {
            return NextResponse.json({ error: 'Excel file is empty or invalid' }, { status: 400 });
        }

        const headers = rawData[0];
        const dateCols: { index: number, dateStr: string, dateObj: Date }[] = [];
        
        // Extract dates from headers starting at index 3
        for (let i = 3; i < headers.length; i++) {
            const h = headers[i];
            if (typeof h === 'number') {
                const dateInfo = XLSX.SSF.parse_date_code(h);
                // Note: dateInfo.m is 1-indexed, JS Date is 0-indexed
                const d = new Date(dateInfo.y, dateInfo.m - 1, dateInfo.d);
                const dateStr = format(d, 'yyyy-MM-dd');
                dateCols.push({ index: i, dateStr, dateObj: d });
            }
        }

        if (dateCols.length === 0) {
            return NextResponse.json({ error: 'No valid date headers found. Check your template.' }, { status: 400 });
        }

        const allDates = dateCols.map(d => d.dateStr).sort();
        const minDate = new Date(allDates[0]);
        const maxDate = new Date(allDates[allDates.length - 1]);
        const fpMaxDate = addDays(maxDate, 1);

        // Extract employee codes
        const employeeRows = rawData.slice(1);
        const employeeCodes = employeeRows.map(r => String(r[0]).trim()).filter(Boolean);

        // Pre-fetch all necessary data from DB
        const shifts = await prisma.shift.findMany();
        const shiftMap = new Map();
        for (const s of shifts) shiftMap.set(s.code.trim().toUpperCase(), s);

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
                // Any IN time before 15:00 belongs to the next day's morning
                if (actIn.getHours() < 15) actIn = addDays(actIn, 1);
                if (actOut.getHours() < 15) actOut = addDays(actOut, 1);
            }
            if (actOut < actIn) actOut = addDays(actOut, 1); // fallback

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

        for (const row of employeeRows) {
            const empCode = String(row[0]).trim();
            if (!empCode) continue;
            const emp = empMap.get(empCode);
            if (!emp) continue;
            const leader = row[2] ? String(row[2]).trim() : 'N/A';

            for (const col of dateCols) {
                const shiftCodeRaw = row[col.index];
                const shiftCode = shiftCodeRaw ? String(shiftCodeRaw).trim().toUpperCase() : '';

                const empLds = lineDataRecords.filter(l => l.employeeId === emp.id && format(l.recordDate, 'yyyy-MM-dd') === col.dateStr);
                const fpToday = fingerprints.find(f => f.employeeId === emp.id && format(f.recordDate, 'yyyy-MM-dd') === col.dateStr);
                const fpNext = fingerprints.find(f => f.employeeId === emp.id && format(f.recordDate, 'yyyy-MM-dd') === format(addDays(col.dateObj, 1), 'yyyy-MM-dd'));

                const shiftConf = shiftMap.get(shiftCode);

                if (shiftConf && shiftConf.isLeave) {
                    results.push({
                        employeeCode: empCode,
                        fullName: emp.fullName,
                        leader: leader,
                        date: col.dateStr,
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
                        status: 'VALID'
                    });
                    continue;
                }
                const isNight = shiftConf && parseTimeStr(shiftConf.endTime, col.dateObj) < parseTimeStr(shiftConf.startTime, col.dateObj);
                
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
                const isNightShift = shiftConf && parseTimeStr(shiftConf.endTime, col.dateObj) < parseTimeStr(shiftConf.startTime, col.dateObj);
                const aggregatedLine = getEarliestLatestLine(empLds, !!isNightShift, col.dateObj);

                const lineInStr = aggregatedLine.lineIn || 'N/A';
                const lineOutStr = aggregatedLine.lineOut || 'N/A';

                let otFp = calcOT(fpIn, fpOut, shiftCode, col.dateObj);
                if (otFp < 0.5) {
                    otFp = 0;
                }
                let otLine = calcOT(aggregatedLine.lineIn, aggregatedLine.lineOut, shiftCode, col.dateObj);
                if (otLine < 0.5) {
                    otLine = 0;
                }
                
                const diff = otFp - otLine;
                
                let varCheckIn = 'N/A';
                let hasCheckInDeviation = false;
                let absCheckInDev: number | null = null;
                if (aggregatedLine.lineIn && shiftConf && shiftConf.startTime) {
                    let lineInTime = parseTimeStr(aggregatedLine.lineIn, col.dateObj);
                    let shiftStartTime = parseTimeStr(shiftConf.startTime, col.dateObj);
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
                    let lineOutTime = parseTimeStr(aggregatedLine.lineOut, col.dateObj);
                    let shiftEndTime = parseTimeStr(shiftConf.endTime, col.dateObj);
                    let shiftStartTime = shiftConf.startTime ? parseTimeStr(shiftConf.startTime, col.dateObj) : null;
                    
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
                    let lineInTime = parseTimeStr(aggregatedLine.lineIn, col.dateObj);
                    let fpInTime = parseTimeStr(fpIn, col.dateObj);
                    let lineOutTime = parseTimeStr(aggregatedLine.lineOut, col.dateObj);
                    let fpOutTime = parseTimeStr(fpOut, col.dateObj);

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

                const isWrongShift = (absCheckInDev !== null && absCheckInDev > 200 && absCheckOutDev !== null && absCheckOutDev > 200);

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
                    date: col.dateStr,
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
                    status
                });
            }
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
