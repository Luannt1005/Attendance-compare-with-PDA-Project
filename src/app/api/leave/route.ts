import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

// Helper to check if string or number is a date
function parseDateValue(h: any): Date | null {
    if (typeof h === 'number' && h > 30000 && h < 60000) {
        try {
            const dateInfo = XLSX.SSF.parse_date_code(h);
            return new Date(dateInfo.y, dateInfo.m - 1, dateInfo.d);
        } catch {
            return null;
        }
    }
    if (typeof h === 'string') {
        const cleaned = h.trim();
        const parts = cleaned.split(/[\/\-]/);
        if (parts.length === 3) {
            let d = new Date(cleaned);
            if (!isNaN(d.getTime())) return d;
            
            const p0 = parseInt(parts[0], 10);
            const p1 = parseInt(parts[1], 10);
            const p2 = parseInt(parts[2], 10);
            if (parts[2].length === 4) {
                // assume m/d/yyyy
                d = new Date(p2, p0 - 1, p1);
                if (!isNaN(d.getTime())) return d;
            }
        }
    }
    return null;
}

// Helper to read Excel file using native fs.readFileSync to bypass Next.js bundling issues with XLSX.readFile
function readExcelFile(filePath: string): XLSX.WorkBook {
    try {
        const buffer = fs.readFileSync(filePath);
        return XLSX.read(buffer, { type: 'buffer' });
    } catch (err: any) {
        throw err;
    }
}

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const search = url.searchParams.get('search') || '';
        const leaveType = url.searchParams.get('leaveType') || '';
        const date = url.searchParams.get('date') || '';

        const whereClause: any = {};

        if (search) {
            whereClause.OR = [
                { employeeCode: { contains: search, mode: 'insensitive' } },
                { employeeName: { contains: search, mode: 'insensitive' } },
                { shiftLeader: { contains: search, mode: 'insensitive' } },
                { lineLeader: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (leaveType) {
            whereClause.leaveType = { equals: leaveType, mode: 'insensitive' };
        }

        if (date) {
            whereClause.recordDate = new Date(date);
        }

        const records = await prisma.leaveRecord.findMany({
            where: whereClause,
            orderBy: { recordDate: 'desc' },
        });

        // Get unique leave types for filters
        const leaveTypes = await prisma.leaveRecord.findMany({
            select: { leaveType: true },
            distinct: ['leaveType'],
        });

        return NextResponse.json({
            records,
            leaveTypes: leaveTypes.map(lt => lt.leaveType),
        });
    } catch (error: any) {
        console.error('Error in leave GET:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const targetFile = 'V:\\MIL_Indirect_Material\\Public\\Data and Project Team\\Luan\\Leave List\\Leave.xlsx';
        const fallbackFile = 'V:\\MIL_Indirect_Material\\Public\\Data and Project Team\\Luan\\Leave List\\Leave list Level 03.xlsx';

        let filePath = targetFile;
        let fileExists = fs.existsSync(targetFile);

        // Check if primary exists and contains data, else try fallback
        let useFallback = false;
        if (!fileExists) {
            useFallback = true;
        } else {
            try {
                // Check if Leave.xlsx is empty
                const wbTemp = readExcelFile(targetFile);
                const sheetTemp = wbTemp.Sheets[wbTemp.SheetNames[0]];
                const tempRows = XLSX.utils.sheet_to_json(sheetTemp, { header: 1 });
                if (tempRows.length < 2) {
                    useFallback = true;
                }
            } catch (err: any) {
                console.error('CRITICAL ERROR CHECKING MAIN FILE:', err);
                const isLockError = err.message && (
                    err.message.includes('EACCES') || 
                    err.message.includes('EBUSY') || 
                    err.message.includes('Cannot access file') ||
                    err.code === 'EACCES' ||
                    err.code === 'EBUSY'
                );
                if (isLockError) {
                    return NextResponse.json({
                        error: 'Tệp tin Excel Leave.xlsx đang bị mở bởi Excel hoặc bị khóa. Vui lòng lưu, đóng tệp tin trong Excel và bấm Đồng bộ lại!'
                    }, { status: 423 });
                }
                console.warn('Warning checking main file:', err.message);
                useFallback = true;
            }
        }

        if (useFallback && fs.existsSync(fallbackFile)) {
            filePath = fallbackFile;
            fileExists = true;
        }

        if (!fileExists) {
            return NextResponse.json({
                error: `Không tìm thấy file tại đường dẫn: ${targetFile}. Vui lòng kiểm tra lại kết nối mạng ổ đĩa V hoặc vị trí file.`
            }, { status: 404 });
        }

        let workbook;
        try {
            workbook = readExcelFile(filePath);
        } catch (err: any) {
            const isLockError = err.message && (
                err.message.includes('EACCES') || 
                err.message.includes('EBUSY') || 
                err.message.includes('Cannot access file') ||
                err.code === 'EACCES' ||
                err.code === 'EBUSY'
            );
            if (isLockError) {
                return NextResponse.json({
                    error: `Tệp tin Excel ${path.basename(filePath)} đang bị mở bởi Excel hoặc bị khóa. Vui lòng lưu, đóng tệp tin trong Excel và bấm Đồng bộ lại!`
                }, { status: 423 });
            }
            throw err;
        }

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        if (rawData.length < 2) {
            return NextResponse.json({ error: 'Tệp tin Excel trống hoặc không hợp lệ.' }, { status: 400 });
        }

        const headers = rawData[0].map(h => String(h || '').trim());
        
        // Format detection
        const hasLeaveType = headers.some(h => h.toLowerCase() === 'leavetype');
        const hasLeaveDate = headers.some(h => h.toLowerCase() === 'leavedate');

        const parsedRecords: any[] = [];
        const employeeRows = rawData.slice(1);

        if (hasLeaveType && hasLeaveDate) {
            // --- FLAT LIST FORMAT ---
            const zoneIdx = headers.findIndex(h => h.toLowerCase() === 'zone');
            const shiftLeaderIdx = headers.findIndex(h => h.toLowerCase() === 'shift leader' || h.toLowerCase() === 'shift_leader');
            const lineLeaderIdx = headers.findIndex(h => h.toLowerCase() === 'line leader' || h.toLowerCase() === 'line_leader');
            const empCodeIdx = headers.findIndex(h => h.toLowerCase() === 'employee id' || h.toLowerCase() === 'employee_id' || h.toLowerCase() === 'mã nv' || h.toLowerCase() === 'staff id');
            const empNameIdx = headers.findIndex(h => h.toLowerCase() === 'employee name' || h.toLowerCase() === 'employee_name' || h.toLowerCase() === 'họ và tên');
            const leaveTypeIdx = headers.findIndex(h => h.toLowerCase() === 'leavetype');
            const leaveDateIdx = headers.findIndex(h => h.toLowerCase() === 'leavedate');

            if (empCodeIdx === -1 || leaveTypeIdx === -1 || leaveDateIdx === -1) {
                return NextResponse.json({
                    error: 'Cấu trúc file dạng bảng (Flat Table) không đúng. Thiếu các cột bắt buộc: "Employee ID", "LeaveType", hoặc "LeaveDate".'
                }, { status: 400 });
            }

            employeeRows.forEach((row) => {
                const empCode = row[empCodeIdx] ? String(row[empCodeIdx]).trim() : null;
                const empName = empNameIdx !== -1 && row[empNameIdx] ? String(row[empNameIdx]).trim() : '';
                const leaveType = leaveTypeIdx !== -1 && row[leaveTypeIdx] ? String(row[leaveTypeIdx]).trim() : null;
                const dateVal = leaveDateIdx !== -1 ? row[leaveDateIdx] : null;

                if (!empCode || !leaveType || !dateVal) return;

                const dateObj = parseDateValue(dateVal);
                if (!dateObj) return;

                const zone = zoneIdx !== -1 && row[zoneIdx] ? String(row[zoneIdx]).trim() : null;
                const shiftLeader = shiftLeaderIdx !== -1 && row[shiftLeaderIdx] ? String(row[shiftLeaderIdx]).trim() : null;
                const lineLeader = lineLeaderIdx !== -1 && row[lineLeaderIdx] ? String(row[lineLeaderIdx]).trim() : null;

                parsedRecords.push({
                    employeeCode: empCode,
                    employeeName: empName,
                    recordDate: dateObj,
                    leaveType,
                    zone,
                    shiftLeader,
                    lineLeader
                });
            });
        } else {
            // --- PIVOT FORMAT ---
            const dateCols: { index: number; dateObj: Date; headerStr: string }[] = [];
            const nonDateFields = {
                employeeCodeIdx: -1,
                employeeNameIdx: -1,
                zoneIdx: -1,
                shiftLeaderIdx: -1,
                lineLeaderIdx: -1
            };

            headers.forEach((h, idx) => {
                const d = parseDateValue(h);
                if (d) {
                    dateCols.push({ index: idx, dateObj: d, headerStr: String(h) });
                } else {
                    const name = h.toLowerCase();
                    if (name === 'employee id' || name === 'employee_id' || name === 'mã nv' || name === 'ma nv' || name === 'staff id') {
                        nonDateFields.employeeCodeIdx = idx;
                    } else if (name === 'employee name' || name === 'employee_name' || name === 'họ và tên' || name === 'ho va ten' || name === 'tên nv') {
                        nonDateFields.employeeNameIdx = idx;
                    } else if (name === 'zone' || name === 'khu vực') {
                        nonDateFields.zoneIdx = idx;
                    } else if (name === 'shift leader' || name === 'shift_leader' || name === 'trưởng ca') {
                        nonDateFields.shiftLeaderIdx = idx;
                    } else if (name === 'line leader' || name === 'line_leader' || name === 'trưởng chuyền') {
                        nonDateFields.lineLeaderIdx = idx;
                    }
                }
            });

            if (nonDateFields.employeeCodeIdx === -1) {
                return NextResponse.json({
                    error: 'Cấu trúc file dạng ngang (Pivot Table) không đúng. Thiếu cột "Employee ID" hoặc "Mã NV".'
                }, { status: 400 });
            }

            employeeRows.forEach((row) => {
                const empCode = row[nonDateFields.employeeCodeIdx]
                    ? String(row[nonDateFields.employeeCodeIdx]).trim()
                    : null;
                const empName = nonDateFields.employeeNameIdx !== -1 && row[nonDateFields.employeeNameIdx]
                    ? String(row[nonDateFields.employeeNameIdx]).trim()
                    : '';
                    
                if (!empCode) return;

                const zone = nonDateFields.zoneIdx !== -1 && row[nonDateFields.zoneIdx] ? String(row[nonDateFields.zoneIdx]).trim() : null;
                const shiftLeader = nonDateFields.shiftLeaderIdx !== -1 && row[nonDateFields.shiftLeaderIdx] ? String(row[nonDateFields.shiftLeaderIdx]).trim() : null;
                const lineLeader = nonDateFields.lineLeaderIdx !== -1 && row[nonDateFields.lineLeaderIdx] ? String(row[nonDateFields.lineLeaderIdx]).trim() : null;

                dateCols.forEach(col => {
                    const val = row[col.index];
                    if (val !== undefined && val !== null && String(val).trim() !== '') {
                        parsedRecords.push({
                            employeeCode: empCode,
                            employeeName: empName,
                            recordDate: col.dateObj,
                            leaveType: String(val).trim(),
                            zone,
                            shiftLeader,
                            lineLeader
                        });
                    }
                });
            });
        }

        if (parsedRecords.length === 0) {
            return NextResponse.json({
                message: 'Không tìm thấy lượt đăng ký nghỉ phép nào trong file.',
                count: 0
            });
        }

        // Transaction to overwrite records
        await prisma.$transaction([
            prisma.leaveRecord.deleteMany(),
            prisma.leaveRecord.createMany({ data: parsedRecords })
        ]);

        return NextResponse.json({
            success: true,
            count: parsedRecords.length,
            fileUsed: path.basename(filePath),
            isFallback: filePath === fallbackFile
        });

    } catch (error: any) {
        console.error('Error in sync leave POST:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
