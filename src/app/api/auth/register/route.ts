import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'

export async function POST(req: Request) {
    try {
        const { username, password, fullName, roleName } = await req.json()

        if (!username || !password || !fullName || !roleName) {
            return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
        }

        // Check if username already exists
        const existingUser = await prisma.user.findUnique({
            where: { username }
        })

        if (existingUser) {
            return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
        }

        // Make sure role exists
        const role = await prisma.role.findUnique({
            where: { name: roleName }
        })

        if (!role) {
            return NextResponse.json({ error: 'Invalid Role specified' }, { status: 400 })
        }

        // Hash the password securely
        const passwordHash = await bcrypt.hash(password, 10)

        // Create the User
        const newUser = await prisma.user.create({
            data: {
                username,
                passwordHash,
                fullName,
                roleId: role.id,
                isActive: true,
            }
        })

        return NextResponse.json({
            message: 'Account created successfully',
            user: {
                username: newUser.username,
                fullName: newUser.fullName,
                role: role.name
            }
        }, { status: 201 })

    } catch (error) {
        console.error('Registration Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
