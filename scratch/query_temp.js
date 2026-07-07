const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const e = await prisma.employee.findUnique({where: {employeeCode: '500186'}});
    if (!e) { console.log('No emp'); return; }
    const ld = await prisma.lineData.findMany({where: {employeeId: e.id}});
    console.log(ld);
}
main().finally(() => prisma.$disconnect());
