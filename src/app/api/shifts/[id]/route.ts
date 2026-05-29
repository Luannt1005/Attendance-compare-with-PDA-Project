import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const params = await context.params;
        const body = await req.json()
        const shift = await prisma.shift.update({
            where: { id: parseInt(params.id) },
            data: {
                code: body.code,
                name: body.name,
                startTime: body.startTime || null,
                endTime: body.endTime || null,
                otPreStart: body.otPreStart,
                otPreEnd: body.otPreEnd,
                otPostStart: body.otPostStart,
                otPostEnd: body.otPostEnd,
                isActive: body.isActive,
                isLeave: body.isLeave ?? false
            }
        })
        return NextResponse.json({ data: shift })
    } catch (e) {
        console.error('Update Shift Error:', e)
        return NextResponse.json({ error: 'Failed to update shift' }, { status: 500 })
    }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const params = await context.params;
        await prisma.shift.delete({
            where: { id: parseInt(params.id) }
        })
        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('Delete Shift Error:', e)
        return NextResponse.json({ error: 'Failed to delete shift' }, { status: 500 })
    }
}
