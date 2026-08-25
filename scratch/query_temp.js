const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const e = await prisma.employee.findUnique({where:{employeeCode:'587924'}});
  if(!e) { console.log('no emp'); return; }
  const fp = await prisma.fingerprint.findMany({where:{employeeId: e.id}});
  console.log('FPs:', fp.filter(f => f.recordDate >= new Date('2026-08-24T00:00:00.000Z')));
}
main();
