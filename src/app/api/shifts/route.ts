import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const shifts = await prisma.shift.findMany({
            orderBy: { id: 'asc' }
        })
        return NextResponse.json({ data: shifts })
    } catch (e) {
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const shift = await prisma.shift.create({
            data: {
                code: body.code,
                name: body.name,
                startTime: body.startTime || null,
                endTime: body.endTime || null,
                otPreStart: body.otPreStart,
                otPreEnd: body.otPreEnd,
                otPostStart: body.otPostStart,
                otPostEnd: body.otPostEnd,
                isActive: body.isActive ?? true,
                isLeave: body.isLeave ?? false
            }
        })
        return NextResponse.json({ data: shift })
    } catch (e) {
        console.error('Create Shift Error:', e)
        return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 })
    }
}
