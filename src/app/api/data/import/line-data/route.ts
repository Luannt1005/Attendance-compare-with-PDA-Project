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

function parseExcelDate(dateVal: any): string | null {
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
        
        let y = 0, m = 0, d = 0;
        
        if (match[1].length === 4) {
            y = p1;
            if (p2 > 12) {
                d = p2;
                m = p3;
            } else if (p3 > 12) {
                m = p2;
                d = p3;
            } else {
                m = p2;
                d = p3;
            }
        } else if (match[3].length === 4) {
            y = p3;
            if (p1 > 12) {
                d = p1;
                m = p2;
            } else if (p2 > 12) {
                m = p1;
                d = p2;
            } else {
                d = p1;
                m = p2;
            }
        } else {
            y = p3 < 50 ? 2000 + p3 : 1900 + p3;
            if (p1 > 12) {
                d = p1;
                m = p2;
            } else if (p2 > 12) {
                m = p1;
                d = p2;
            } else {
                d = p1;
                m = p2;
            }
        }
        
        if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
            throw new Error('Excel sheet is empty');
        }

        const uniqueDates = new Set<string>();
        const empCodeSet = new Set<string>();
        const parsedRows: { empCode: string, date: string, in: string | null, out: string | null, shift: string, line: string }[] = [];

        for (const row of rawData) {
            let staffNo = getFieldValue(row, ['Staff No', 'Staff ID', 'Mã NV', 'Employee Code', 'EmployeeCode', 'StaffNo', 'StaffID', 'MaNV']);
            let dateVal = getFieldValue(row, ['Date', 'Ngay', 'Ngày']);
            let clockIn = getFieldValue(row, ['Clock IN', 'IN', 'Gio vao', 'Giờ vào', 'ClockIn', 'InTime', 'Giờ Vô']);
            let clockOut = getFieldValue(row, ['Clock OUT', 'OUT', 'Gio ra', 'Giờ ra', 'ClockOut', 'OutTime', 'Giờ Ra']);

            if (staffNo === undefined || staffNo === null || dateVal === undefined || dateVal === null) continue;
            
            let employeeCode = String(staffNo).replace(/\$/g, '').trim();
            let dateStr = parseExcelDate(dateVal);

            if (!dateStr || !employeeCode) continue;

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
            return NextResponse.json({ error: 'No valid data found in file for the selected criteria' }, { status: 400 });
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
            select: { id: true, employeeCode: true }
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
                        fullName: 'Unknown Employee',
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
