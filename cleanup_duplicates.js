const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('--- STARTING DATABASE CLEANUP FOR DUPLICATE CODES ---');
    
    // Find all placeholder accounts or accounts with leading zeros
    const allEmps = await prisma.employee.findMany();
    console.log(`Loaded ${allEmps.length} employees from database.`);

    let mergeCount = 0;

    for (const emp of allEmps) {
        const rawCode = emp.employeeCode;
        // Check if code has leading zeros, e.g. "000850"
        if (/^0+\d+$/.test(rawCode)) {
            const normalizedCode = rawCode.replace(/^0+/, '');
            
            // Find if there is a real employee with the normalized code
            const realEmp = allEmps.find(e => e.employeeCode === normalizedCode && e.id !== emp.id);
            if (realEmp) {
                console.log(`Merging duplicate: "${rawCode}" (${emp.fullName}) -> "${normalizedCode}" (${realEmp.fullName})`);

                // Update relations to point to the real employee
                // 1. LineData
                const ldUpdate = await prisma.lineData.updateMany({
                    where: { employeeId: emp.id },
                    data: { employeeId: realEmp.id }
                });

                // 2. Fingerprint
                const fpUpdate = await prisma.fingerprint.updateMany({
                    where: { employeeId: emp.id },
                    data: { employeeId: realEmp.id }
                });

                // 3. Attendance
                const attUpdate = await prisma.attendance.updateMany({
                    where: { employeeId: emp.id },
                    data: { employeeId: realEmp.id }
                });

                // 4. ClerkAttendance
                const clAttUpdate = await prisma.clerkAttendance.updateMany({
                    where: { employeeId: emp.id },
                    data: { employeeId: realEmp.id }
                });

                // 5. Overtime
                const otUpdate = await prisma.overtime.updateMany({
                    where: { employeeId: emp.id },
                    data: { employeeId: realEmp.id }
                });

                // 6. ClerkOvertime
                const clOtUpdate = await prisma.clerkOvertime.updateMany({
                    where: { employeeId: emp.id },
                    data: { employeeId: realEmp.id }
                });

                // 7. LeaveRecord - wait, LeaveRecord has employeeCode field or employee relation?
                // Let's check if LeaveRecord has employee relation or just employeeCode string.
                // In route.ts, it uses employeeCode string and does not link directly by id, but let's update employeeCode string just in case:
                const leaveUpdate = await prisma.leaveRecord.updateMany({
                    where: { employeeCode: rawCode },
                    data: { employeeCode: normalizedCode }
                });

                console.log(`  Updated relations: LineData (${ldUpdate.count}), Fingerprint (${fpUpdate.count}), Attendance (${attUpdate.count}), ClerkAttendance (${clAttUpdate.count}), Overtime (${otUpdate.count}), ClerkOvertime (${clOtUpdate.count}), Leave (${leaveUpdate.count})`);

                // Delete the duplicate placeholder employee
                await prisma.employee.delete({
                    where: { id: emp.id }
                });
                console.log(`  Deleted placeholder employee ID: ${emp.id}`);
                mergeCount++;
            } else {
                // No real employee matches this code without leading zeros.
                // We will normalize the code of this employee directly so it matches future imports!
                console.log(`Normalizing code of solo employee: "${rawCode}" (${emp.fullName}) -> "${normalizedCode}"`);
                
                // First update LeaveRecords
                await prisma.leaveRecord.updateMany({
                    where: { employeeCode: rawCode },
                    data: { employeeCode: normalizedCode }
                });

                await prisma.employee.update({
                    where: { id: emp.id },
                    data: { employeeCode: normalizedCode }
                });
            }
        }
    }

    console.log(`--- CLEANUP COMPLETED. Merged ${mergeCount} duplicate placeholders. ---`);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect().then(() => pool.end()));
