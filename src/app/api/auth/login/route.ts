import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/auth'
import bcrypt from 'bcrypt'

export async function POST(req: Request) {
    try {
        const { username, password } = await req.json()

        if (!username || !password) {
            return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
        }

        const user = await prisma.user.findUnique({
            where: { username },
            include: { role: true },
        })

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
        }

        if (!user.isActive) {
            return NextResponse.json({ error: 'User account is inactive' }, { status: 403 })
        }

        // Create JWT containing user info
        const token = await encrypt({
            id: user.id,
            username: user.username,
            role: user.role.name,
            fullName: user.fullName,
        })

        return NextResponse.json({
            token, user: {
                id: user.id,
                username: user.username,
                role: user.role.name,
                fullName: user.fullName
            }
        }, { status: 200 })

    } catch (error) {
        console.error('Login Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
