import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
    try {
        const { changes, otChanges } = await req.json()

        // Handle attendance changes
        if (changes && Array.isArray(changes) && changes.length > 0) {
            await prisma.$transaction(
                changes.map((change: any) => {
                    if (!change.status) {
                        return prisma.attendance.deleteMany({
                            where: {
                                employeeId: change.employeeId,
                                recordDate: new Date(change.recordDate)
                            }
                        })
                    }

                    return prisma.attendance.upsert({
                        where: {
                            employeeId_recordDate: {
                                employeeId: change.employeeId,
                                recordDate: new Date(change.recordDate)
                            }
                        },
                        update: {
                            status: change.status
                        },
                        create: {
                            employeeId: change.employeeId,
                            recordDate: new Date(change.recordDate),
                            status: change.status
                        }
                    })
                })
            )
        }

        // Handle OT changes
        if (otChanges && Array.isArray(otChanges) && otChanges.length > 0) {
            for (const change of otChanges) {
                if (change.hours === '' || change.hours === null || isNaN(change.hours) || change.hours <= 0) {
                    await prisma.overtime.deleteMany({
                        where: {
                            employeeId: change.employeeId,
                            recordDate: new Date(change.recordDate)
                        }
                    })
                    continue;
                }

                const existingOT = await prisma.overtime.findFirst({
                    where: {
                        employeeId: change.employeeId,
                        recordDate: new Date(change.recordDate)
                    }
                })

                if (existingOT) {
                    await prisma.overtime.update({
                        where: { id: existingOT.id },
                        data: { hours: parseFloat(change.hours) }
                    })
                } else {
                    await prisma.overtime.create({
                        data: {
                            employeeId: change.employeeId,
                            recordDate: new Date(change.recordDate),
                            hours: parseFloat(change.hours),
                            timeType: 'Day'
                        }
                    })
                }
            }
        }

        return NextResponse.json({ message: 'Saved successfully' })
    } catch (error: any) {
        console.error('Bulk API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
