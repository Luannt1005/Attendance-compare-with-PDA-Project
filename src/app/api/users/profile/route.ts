import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'

export async function PUT(req: Request) {
    try {
        const body = await req.json()
        const { userId, fullName, password } = body

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
        }

        const updateData: any = {}
        if (fullName) {
            updateData.fullName = fullName
        }
        if (password) {
            updateData.passwordHash = await bcrypt.hash(password, 10)
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ success: true, message: 'No changes made' })
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: updateData
        })

        return NextResponse.json({ success: true, user: { id: user.id, fullName: user.fullName } })
    } catch (e: any) {
        console.error('Profile update error', e)
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }
}
