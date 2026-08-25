import { prisma } from '../src/lib/prisma.js';

async function main() {
    const empCode = '587924';
    const emp = await prisma.employee.findUnique({ where: { employeeCode: empCode } });
    if (!emp) return console.log('Emp not found');
    
    const fp24 = await prisma.fingerprint.findFirst({ where: { employeeId: emp.id, recordDate: new Date('2026-08-24T00:00:00.000Z') } });
    const fp25 = await prisma.fingerprint.findFirst({ where: { employeeId: emp.id, recordDate: new Date('2026-08-25T00:00:00.000Z') } });
    
    console.log('FP 24:', fp24);
    console.log('FP 25:', fp25);
    
    const lds24 = await prisma.lineData.findMany({ where: { employeeId: emp.id, recordDate: new Date('2026-08-24T00:00:00.000Z') } });
    console.log('Line 24:', lds24);
}
main().catch(console.error).finally(() => prisma.$disconnect());
