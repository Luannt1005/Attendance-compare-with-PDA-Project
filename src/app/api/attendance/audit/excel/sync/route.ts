import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { validCases } = body

        if (!validCases || !Array.isArray(validCases)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
        }

        let updatedCount = 0;

        // Group by employee to minimize queries
        const casesByEmp: Record<string, any[]> = {};
        for (const c of validCases) {
            if (!c.employeeCode || !c.date) continue;
            if (!casesByEmp[c.employeeCode]) casesByEmp[c.employeeCode] = [];
            casesByEmp[c.employeeCode].push(c);
        }

        const employeeCodes = Object.keys(casesByEmp);
        const emps = await prisma.employee.findMany({
            where: { employeeCode: { in: employeeCodes } },
            select: { id: true, employeeCode: true }
        });

        const empMap = new Map(emps.map(e => [e.employeeCode, e.id]));

        await prisma.$transaction(async (tx) => {
            for (const [empCode, cases] of Object.entries(casesByEmp)) {
                const empId = empMap.get(empCode);
                if (!empId) continue;

                for (const c of cases) {
                    const recordDate = new Date(c.date);
                    
                    // Sync Shift (ClerkAttendance)
                    if (c.submittedShift) {
                        await tx.clerkAttendance.upsert({
                            where: {
                                employeeId_recordDate: {
                                    employeeId: empId,
                                    recordDate: recordDate
                                }
                            },
                            create: {
                                employeeId: empId,
                                recordDate: recordDate,
                                status: c.submittedShift
                            },
                            update: {
                                status: c.submittedShift
                            }
                        });
                    }

                    // Sync OT (ClerkOvertime)
                    const otVal = parseFloat(String(c.submittedOt || '0'));
                    if (!isNaN(otVal) && otVal > 0) {
                        const existingOt = await tx.clerkOvertime.findFirst({
                            where: { employeeId: empId, recordDate: recordDate }
                        });
                        if (existingOt) {
                            await tx.clerkOvertime.update({
                                where: { id: existingOt.id },
                                data: { hours: otVal }
                            });
                        } else {
                            await tx.clerkOvertime.create({
                                data: {
                                    employeeId: empId,
                                    recordDate: recordDate,
                                    hours: otVal,
                                    timeType: 'Day'
                                }
                            });
                        }
                    } else {
                        // Delete OT if 0 or null
                        await tx.clerkOvertime.deleteMany({
                            where: {
                                employeeId: empId,
                                recordDate: recordDate
                            }
                        });
                    }
                    updatedCount++;
                }
            }
        });

        return NextResponse.json({ success: true, count: updatedCount });
    } catch (e: any) {
        console.error("Error syncing valid cases:", e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
