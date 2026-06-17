const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const XLSX = require('c:\\Users\\luan.nguyen\\Desktop\\Project on Server\\TimeKeeping App Project\\node_modules\\xlsx');
const fs = require('fs');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const filePath = 'C:\\Users\\luan.nguyen\\Downloads\\Book4.xlsx';

// Helper to extract In/Out time from string
function extractInOut(timeString) {
    if (!timeString) return { inTime: null, outTime: null };
    const parts = timeString.split(',').map(s => s.trim()).filter(Boolean).sort();
    if (parts.length === 0) return { inTime: null, outTime: null };
    if (parts.length === 1) return { inTime: parts[0], outTime: null };
    return { inTime: parts[0], outTime: parts[parts.length - 1] };
}

async function main() {
    console.log('--- STARTING ANALYSIS OF SHIFT IMPORT SKIPPED ROWS ---');
    const workbook = XLSX.readFile(filePath);
    
    const shiftAssignments = [];
    const employeeCodesSet = new Set();
    const codeToNameMap = new Map();

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const headerRow = rawData[0];
    const dVal = headerRow[3];
    const dateObj = new Date(1899, 11, 30 + dVal);
    const dateStr = dateObj.toISOString().slice(0, 10);
    const nextDateStr = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    console.log('Detected Shift Date:', dateStr);

    const employeeRows = rawData.slice(1);
    for (const row of employeeRows) {
        const empCode = String(row[0] || '').trim().replace(/^0+/, '');
        if (!empCode) continue;

        employeeCodesSet.add(empCode);
        const name = row[1] ? String(row[1]).trim() : 'Unknown Employee';
        if (name && name !== 'Unknown Employee' && name !== 'Unknown') {
            codeToNameMap.set(empCode, name);
        }

        const leader = row[2] ? String(row[2]).trim() : 'N/A';
        const shiftCodeRaw = row[3];
        const shiftCode = shiftCodeRaw ? String(shiftCodeRaw).trim().toUpperCase() : '';

        shiftAssignments.push({
            empCode,
            fullName: name,
            leader,
            dateStr,
            dateObj,
            shiftCode
        });
    }

    const employeeCodes = Array.from(employeeCodesSet);
    const allEmployees = await prisma.employee.findMany({
        where: { employeeCode: { in: employeeCodes } }
    });
    
    const empMap = new Map();
    for (const e of allEmployees) empMap.set(e.employeeCode, e);

    // Fetch line data and fingerprints for the date
    const lineDataRecords = await prisma.lineData.findMany({
        where: {
            recordDate: dateObj
        }
    });

    const fingerprints = await prisma.fingerprint.findMany({
        where: {
            recordDate: {
                in: [dateObj, new Date(dateObj.getTime() + 24 * 60 * 60 * 1000)]
            }
        }
    });

    console.log(`Line records in DB for ${dateStr}:`, lineDataRecords.length);
    console.log(`Fingerprint records in DB:`, fingerprints.length);

    let skippedEmptyCount = 0;
    let includedCount = 0;

    const skippedSamples = [];

    for (const assignment of shiftAssignments) {
        const emp = empMap.get(assignment.empCode);
        if (!emp) continue;

        const empLds = lineDataRecords.filter(l => l.employeeId === emp.id);
        const fpToday = fingerprints.find(f => f.employeeId === emp.id && f.recordDate.toISOString().slice(0, 10) === dateStr);
        const fpNext = fingerprints.find(f => f.employeeId === emp.id && f.recordDate.toISOString().slice(0, 10) === nextDateStr);

        let fpIn = null;
        let fpOut = null;
        if (fpToday) {
            const parsed = extractInOut(fpToday.timeString);
            fpIn = parsed.inTime;
            fpOut = parsed.outTime;
        }

        const lineIn = empLds.length > 0 ? empLds[0].lineIn : null;
        const lineOut = empLds.length > 0 ? empLds[0].lineOut : null;

        const hasFingerprint = fpIn || fpOut;
        const hasLineData = lineIn || lineOut || empLds.length > 0;

        let reason = '';
        if (assignment.shiftCode === '') {
            if (!hasFingerprint && !hasLineData) {
                reason = 'Không đăng kí ca và không đi làm';
            } else {
                reason = 'Đi làm nhưng không đăng kí ca';
            }
        }

        if (reason === 'Không đăng kí ca và không đi làm') {
            skippedEmptyCount++;
            if (skippedSamples.length < 5) {
                skippedSamples.push({
                    code: assignment.empCode,
                    name: emp.fullName,
                    shiftCode: assignment.shiftCode
                });
            }
        } else {
            includedCount++;
        }
    }

    console.log('Total shift assignments:', shiftAssignments.length);
    console.log('Skipped (Không đăng kí ca và không đi làm):', skippedEmptyCount);
    console.log('Included records returned to client:', includedCount);
    console.log('Sample skipped employees:', JSON.stringify(skippedSamples, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect().then(() => pool.end()));
