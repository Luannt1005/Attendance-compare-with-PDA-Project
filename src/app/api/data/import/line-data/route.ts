import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import { isValid } from 'date-fns';

function getFieldValue(row: any, keys: string[]): any {
    const lowercaseKeys = keys.map(k => k.trim().toLowerCase());
    for (const [key, value] of Object.entries(row)) {
        if (lowercaseKeys.includes(key.trim().toLowerCase())) {
            return value;
        }
    }
    return undefined;
}

function parseExcelDate(dateVal: any, filterDate?: string): string | null {
    if (dateVal === undefined || dateVal === null) return null;
    
    if (dateVal instanceof Date) {
        if (!isNaN(dateVal.getTime())) {
            const y = dateVal.getFullYear();
            const m = String(dateVal.getMonth() + 1).padStart(2, '0');
            const d = String(dateVal.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        return null;
    }
    
    if (typeof dateVal === 'number') {
        const date = new Date((dateVal - 25569) * 86400 * 1000);
        if (!isNaN(date.getTime())) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        return null;
    }
    
    const str = String(dateVal).trim();
    if (!str) return null;

    const isoMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (isoMatch) {
        const y = isoMatch[1];
        const m = isoMatch[2].padStart(2, '0');
        const d = isoMatch[3].padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    const match = str.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
    if (match) {
        const p1 = parseInt(match[1], 10);
        const p2 = parseInt(match[2], 10);
        const p3 = parseInt(match[3], 10);
        
        let possibleDates: string[] = [];
        
        if (match[1].length === 4) {
            const y = p1;
            if (p2 >= 1 && p2 <= 12 && p3 >= 1 && p3 <= 31) {
                possibleDates.push(`${y}-${String(p2).padStart(2, '0')}-${String(p3).padStart(2, '0')}`);
            }
            if (p3 >= 1 && p3 <= 12 && p2 >= 1 && p2 <= 31 && p2 !== p3) {
                possibleDates.push(`${y}-${String(p3).padStart(2, '0')}-${String(p2).padStart(2, '0')}`);
            }
        } else if (match[3].length === 4) {
            const y = p3;
            if (p2 >= 1 && p2 <= 12 && p1 >= 1 && p1 <= 31) {
                possibleDates.push(`${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`);
            }
            if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 31 && p1 !== p2) {
                possibleDates.push(`${y}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`);
            }
        } else {
            const y = p3 < 50 ? 2000 + p3 : 1900 + p3;
            if (p2 >= 1 && p2 <= 12 && p1 >= 1 && p1 <= 31) {
                possibleDates.push(`${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`);
            }
            if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 31 && p1 !== p2) {
                possibleDates.push(`${y}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`);
            }
        }
        
        if (possibleDates.length > 0) {
            if (filterDate && possibleDates.includes(filterDate)) {
                return filterDate;
            }
            return possibleDates[0];
        }
    }
    
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    
    return null;
}

function parseExcelTime(timeVal: any): string | null {
    if (timeVal === undefined || timeVal === null || timeVal === '') return null;

    if (typeof timeVal === 'number') {
        let totalSeconds = Math.round(timeVal * 24 * 3600);
        if (totalSeconds < 0) totalSeconds = 0;
        if (totalSeconds >= 86400) totalSeconds = 86399;
        
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    const str = String(timeVal).trim();
    if (!str || str === 'N/A' || str === 'null') return null;

    const isPM = /pm/i.test(str);
    const isAM = /am/i.test(str);

    const match = str.match(/(\d{1,2}):(\d{2})/);
    if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);

        if (isPM && hours < 12) {
            hours += 12;
        } else if (isAM && hours === 12) {
            hours = 0;
        }

        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }
    }

    return null;
}

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const filterDate = formData.get('filterDate') as string;
        
        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Parse the excel file
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        const rawData = XLSX.utils.sheet_to_json(sheet, { raw: false }) as any[];
        if (!rawData || rawData.length === 0) {
            return NextResponse.json({ error: 'File Excel rỗng hoặc không hợp lệ' }, { status: 400 });
        }

        // Define expected headers for checking and matching
        const staffNoKeys = ['Staff No', 'Staff ID', 'Mã NV', 'Employee Code', 'EmployeeCode', 'StaffNo', 'StaffID', 'MaNV', 'Mã nhân viên', 'Ma nhan vien'];
        const dateValKeys = ['Date', 'Ngay', 'Ngày', 'Ngày làm việc', 'Ngay lam viec', 'Work Date', 'WorkDate', 'Ngày tháng', 'Ngay thang'];
        const clockInKeys = ['Clock IN', 'IN', 'Gio vao', 'Giờ vào', 'ClockIn', 'InTime', 'Giờ Vô', 'IN Line', 'INLine', 'Line IN', 'LineIN', 'Vào', 'Vô', 'Giờ đi làm'];
        const clockOutKeys = ['Clock OUT', 'OUT', 'Gio ra', 'Giờ ra', 'ClockOut', 'OutTime', 'Giờ Ra', 'OUT Line', 'OUTLine', 'Line OUT', 'LineOUT', 'Ra', 'Về', 'Giờ về'];

        // Get all unique keys found across all rows in the Excel sheet
        const allKeys = new Set<string>();
        rawData.forEach(row => {
            Object.keys(row).forEach(k => allKeys.add(k));
        });

        // Verify if we have at least one column for staff number and one for date
        const hasStaffNo = Array.from(allKeys).some(k => staffNoKeys.map(sk => sk.toLowerCase().trim()).includes(k.toLowerCase().trim()));
        const hasDateVal = Array.from(allKeys).some(k => dateValKeys.map(dk => dk.toLowerCase().trim()).includes(k.toLowerCase().trim()));

        if (!hasStaffNo || !hasDateVal) {
            const foundHeaders = Array.from(allKeys).join(', ');
            return NextResponse.json({ 
                error: `File Excel thiếu cột bắt buộc. Cần cột chứa Mã nhân viên (ví dụ: "Mã nhân viên", "Mã NV", "Staff No") và Ngày làm việc (ví dụ: "Ngày làm việc", "Ngày tháng", "Date"). Các cột tìm thấy trong file: [${foundHeaders}]`
            }, { status: 400 });
        }

        const uniqueDates = new Set<string>();
        const empCodeSet = new Set<string>();
        const parsedRows: { empCode: string, date: string, in: string | null, out: string | null, shift: string, line: string }[] = [];

        // Track debug/validation metrics
        const fileDates = new Set<string>();
        let totalRowsWithHeaders = 0;

        const codeToNameMap = new Map<string, string>();

        for (const row of rawData) {
            let staffNo = getFieldValue(row, staffNoKeys);
            let nameVal = getFieldValue(row, ['Họ và Tên', 'Ho va Ten', 'Full Name', 'FullName', 'Name', 'Tên', 'Ten']);
            let dateVal = getFieldValue(row, dateValKeys);
            let clockIn = getFieldValue(row, clockInKeys);
            let clockOut = getFieldValue(row, clockOutKeys);

            if (staffNo === undefined || staffNo === null || dateVal === undefined || dateVal === null) continue;
            
            totalRowsWithHeaders++;
            let employeeCode = String(staffNo).replace(/\$/g, '').trim().replace(/^0+/, '');
            let dateStr = parseExcelDate(dateVal, filterDate);

            if (!dateStr || !employeeCode) continue;

            const name = nameVal ? String(nameVal).trim() : 'Unknown Employee';
            if (name && name !== 'Unknown Employee' && name !== 'Unknown') {
                codeToNameMap.set(employeeCode.toLowerCase(), name);
            }

            fileDates.add(dateStr);

            // Optional filter Date
            if (filterDate && dateStr !== filterDate) continue;

            empCodeSet.add(employeeCode);
            uniqueDates.add(dateStr);

            let inTimeStr = parseExcelTime(clockIn);
            let outTimeStr = parseExcelTime(clockOut);

            const shiftType = getFieldValue(row, ['Shift', 'Ca', 'Ca lam viec', 'Ca làm việc']) || '';
            const lineName = getFieldValue(row, ['Line', 'Chuyen', 'Chuyền', 'LineName']) || '';

            parsedRows.push({
                empCode: employeeCode,
                date: dateStr,
                in: inTimeStr,
                out: outTimeStr,
                shift: String(shiftType).trim(),
                line: String(lineName).trim()
            });
        }

        const employeeCodes = Array.from(empCodeSet);
        if (employeeCodes.length === 0) {
            if (totalRowsWithHeaders === 0) {
                return NextResponse.json({ 
                    error: 'Không tìm thấy dữ liệu hợp lệ trong file Excel. Vui lòng kiểm tra lại cấu trúc file.' 
                }, { status: 400 });
            }
            if (fileDates.size > 0 && filterDate && !fileDates.has(filterDate)) {
                return NextResponse.json({ 
                    error: `Ngày được chọn trên hệ thống là ${filterDate}, nhưng file Excel được tải lên chỉ chứa dữ liệu các ngày: ${Array.from(fileDates).join(', ')}. Vui lòng chọn đúng ngày hoặc kiểm tra lại file.` 
                }, { status: 400 });
            }
            return NextResponse.json({ 
                error: `Không tìm thấy dữ liệu hợp lệ khớp với ngày đã chọn (${filterDate || ''}).` 
            }, { status: 400 });
        }

        // Fetch valid employee IDs using OR to support multiple casing
        const dbEmps = await prisma.employee.findMany({
            where: {
                OR: [
                    { employeeCode: { in: employeeCodes } },
                    { employeeCode: { in: employeeCodes.map(c => c.toLowerCase()) } },
                    { employeeCode: { in: employeeCodes.map(c => c.toUpperCase()) } }
                ]
            },
            select: { id: true, employeeCode: true, fullName: true }
        });

        // Map keys case-insensitively for lookup
        const empMap = new Map(dbEmps.map(e => [e.employeeCode.toLowerCase(), e.id]));

        // 1.5 Auto-create missing employees so NOTHING is skipped
        const missingCodes = employeeCodes.filter(code => !empMap.has(code.toLowerCase()));
        if (missingCodes.length > 0) {
            // Ensure Dummy Department and Line exist
            let dummyDept = await prisma.department.findUnique({ where: { name: 'Unknown Department' } });
            if (!dummyDept) {
                dummyDept = await prisma.department.create({ data: { name: 'Unknown Department' } });
            }

            let dummyLine = await prisma.line.findFirst({ where: { departmentId: dummyDept.id, name: 'Unknown Line' } });
            if (!dummyLine) {
                dummyLine = await prisma.line.create({ data: { departmentId: dummyDept.id, name: 'Unknown Line' } });
            }

            // Create placeholder employees in a transaction
            const newEmps = await prisma.$transaction(
                missingCodes.map(code => prisma.employee.create({
                    data: {
                        employeeCode: code,
                        fullName: codeToNameMap.get(code.toLowerCase()) || 'Unknown Employee',
                        departmentId: dummyDept.id,
                        lineId: dummyLine.id,
                        joinDate: new Date(),
                        status: 'Active'
                    }
                }))
            );
            // Add new ones to map
            newEmps.forEach(e => empMap.set(e.employeeCode.toLowerCase(), e.id));
        }

        // Auto-update existing employees who have 'Unknown Employee' or 'Unknown' as full name
        const empsToUpdate = dbEmps.filter(e => e.fullName === 'Unknown Employee' || e.fullName === 'Unknown');
        if (empsToUpdate.length > 0) {
            const updateOps = empsToUpdate.map(e => {
                const newName = codeToNameMap.get(e.employeeCode.toLowerCase());
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

        // Delete existing LineData for the dates we are importing
        if (uniqueDates.size > 0) {
            const dateObjects = Array.from(uniqueDates).map(d => new Date(d));
            await prisma.lineData.deleteMany({
                where: {
                    recordDate: { in: dateObjects }
                }
            });
        }

        // Prepare insertions
        const insertData = [];
        let processed = 0;

        for (const lineData of parsedRows) {
            const empId = empMap.get(lineData.empCode.toLowerCase());
            if (!empId) continue; // Skip unknown employees

            // Validate date
            const recordDate = new Date(lineData.date);
            if (!isValid(recordDate)) continue;

            insertData.push({
                employeeId: empId,
                recordDate: recordDate,
                lineIn: lineData.in,
                lineOut: lineData.out,
                shift: lineData.shift,
                line: lineData.line
            });
            processed++;
        }

        // Insert in chunks of 500
        const chunkSize = 500;
        for (let i = 0; i < insertData.length; i += chunkSize) {
            const chunk = insertData.slice(i, i + chunkSize);
            await prisma.lineData.createMany({
                data: chunk
            });
        }

        return NextResponse.json({ 
            success: true,
            processed: processed
        });

    } catch (e: any) {
        console.error('Line Data Import Error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
