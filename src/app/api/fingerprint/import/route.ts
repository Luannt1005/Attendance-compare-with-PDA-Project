import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parse } from 'date-fns'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { fingerprints } = body // Expected shape: { fingerprints: { employeeCode: string, date: string, timeString: string }[] }

        if (!Array.isArray(fingerprints) || fingerprints.length === 0) {
            return NextResponse.json({ error: 'No fingerprint data provided' }, { status: 400 })
        }

        // Normalize all incoming employee codes (strip leading zeros so 000850 -> 850)
        fingerprints.forEach((f: any) => {
            f.employeeCode = String(f.employeeCode).replace(/^0+/, '')
        })

        // 1. Collect all employee codes to fetch their IDs
        const employeeCodes = [...new Set(fingerprints.map((f: any) => f.employeeCode))] as string[]

        const employees = await prisma.employee.findMany({
            where: { employeeCode: { in: employeeCodes } },
            select: { id: true, employeeCode: true }
        })

        const empMap = new Map<string, number>()
        employees.forEach(e => empMap.set(e.employeeCode, e.id))

        // 1.5 Auto-create missing employees so NOTHING is skipped
        const missingCodes = employeeCodes.filter(code => !empMap.has(code))
        if (missingCodes.length > 0) {
            // Ensure Dummy Department and Line exist
            let dummyDept = await prisma.department.findUnique({ where: { name: 'Unknown Department' } })
            if (!dummyDept) {
                dummyDept = await prisma.department.create({ data: { name: 'Unknown Department' } })
            }

            let dummyLine = await prisma.line.findFirst({ where: { departmentId: dummyDept.id, name: 'Unknown Line' } })
            if (!dummyLine) {
                dummyLine = await prisma.line.create({ data: { departmentId: dummyDept.id, name: 'Unknown Line' } })
            }

            // Create placeholder employees
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
            )
            // Add new ones to map
            newEmps.forEach(e => empMap.set(e.employeeCode, e.id))
        }

        // 2. Prepare UPSERT queries
        console.log(`Processing ${fingerprints.length} raw fingerprint records...`)
        let validRecords = 0;

        // We will do a transaction with upsert commands chunked to avoid large transaction limits
        const chunkSize = 1000;

        for (let i = 0; i < fingerprints.length; i += chunkSize) {
            const chunk = fingerprints.slice(i, i + chunkSize);
            const queries = [];

            for (const fp of chunk) {
                const empId = empMap.get(fp.employeeCode);
                if (!empId) continue; // Should not happen now since we auto-created missing ones

                // Parse Date string (DD/MM/YYYY) to Date object
                let recordDate: Date;
                try {
                    recordDate = parse(fp.date, 'dd/MM/yyyy', new Date());
                    // Normalize to UTC 00:00 to avoid timezone offset mismatches in DB
                    recordDate = new Date(Date.UTC(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate()));
                } catch (e) {
                    continue; // Skip invalid dates
                }

                queries.push(
                    prisma.fingerprint.upsert({
                        where: {
                            employeeId_recordDate: {
                                employeeId: empId,
                                recordDate: recordDate
                            }
                        },
                        update: {
                            timeString: fp.timeString
                        },
                        create: {
                            employeeId: empId,
                            recordDate: recordDate,
                            timeString: fp.timeString
                        }
                    })
                )
                validRecords++
            }

            if (queries.length > 0) {
                await prisma.$transaction(queries)
            }
        }

        return NextResponse.json({ message: 'Success', processed: validRecords })

    } catch (error) {
        console.error('Fingerprint Import API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
