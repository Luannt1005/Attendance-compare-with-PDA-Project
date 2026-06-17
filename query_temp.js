const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Querying duplicate placeholder employees with leading zeros:');
    const emps = await prisma.employee.findMany({
        where: {
            fullName: 'Unknown Employee'
        }
    });
    console.log(`Found ${emps.length} placeholders.`);
    for (const e of emps) {
        const normalized = String(parseInt(e.employeeCode, 10));
        const realEmp = await prisma.employee.findFirst({
            where: {
                employeeCode: normalized,
                fullName: { not: 'Unknown Employee' }
            }
        });
        if (realEmp) {
            console.log(`Duplicate found: placeholder ${e.employeeCode} vs real employee ${realEmp.employeeCode} (${realEmp.fullName})`);
        }
    }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect().then(() => pool.end()));
