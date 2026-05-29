
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { prisma } from './prisma';
import { format, eachDayOfInterval } from 'date-fns';
import * as path from 'path';

const EXCEL_PATH = 'V:\\Production\\Share\\PT Tool\\01.Sản xuất MIL-Console-Clerk Team\\01. Chấm Công_Attendance\\01. BCC Console\\06.BCC-2026\\04. T04-2026\\01.Sang_ Apr_2026 Attendance OT Production.xlsx';

export async function getAprilExcelData(leaderId?: string | null) {
    try {
        console.log('Reading Excel from:', EXCEL_PATH);
        if (!fs.existsSync(EXCEL_PATH)) {
            throw new Error(`File does not exist or network drive not accessible: ${EXCEL_PATH}`);
        }
        const fileBuffer = fs.readFileSync(EXCEL_PATH);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true, dateNF: 'yyyy-mm-dd' });

        
        const tsSheet = workbook.Sheets['TS'] || workbook.Sheets[workbook.SheetNames[0]];
        const otSheet = workbook.Sheets['OT'];
        if (!tsSheet) throw new Error('TS Sheet not found');

        const rawData = XLSX.utils.sheet_to_json(tsSheet, { header: 1, raw: false, dateNF: 'd-mmm' }) as any[][]
        if (!rawData || rawData.length < 1) throw new Error('TS Sheet is empty');

        let headerRowIndex = 0;
        let empCodeIdx = -1;
        for (let i = 0; i < Math.min(rawData.length, 30); i++) {
            const row = rawData[i];
            if (!row) continue;
            const idx = row.findIndex(cell => {
                const s = String(cell || '').toLowerCase().trim();
                return s === 'employee code' || s === 'mã nv' || s === 'emp code' || s === 'mã nhân viên';
            });
            if (idx !== -1) {
                empCodeIdx = idx;
                headerRowIndex = i;
                break;
            }
        }

        if (empCodeIdx === -1) {
            empCodeIdx = 2; // Default for these templates
            headerRowIndex = 0;
        }

        const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
        const getColIdx = (aliases: string[]) => {
            const lowerAliases = aliases.map(a => a.toLowerCase());
            return headers.findIndex(h => h && lowerAliases.includes(h.toLowerCase()));
        };

        const fullNameIdx = getColIdx(['full name', 'họ và tên', 'họ tên', 'name']);
        const leaderIdx = getColIdx(['line leader', 'contact person', 'supervisor', 'leader', 'new leader']);
        const picIdx = getColIdx(['pic']);
        const mgtIdx = getColIdx(['mgt (group)', 'mgt', 'mode', 'group']);
        const typeIdx = getColIdx(['type', 'employment type', 'loại']);
        const titleIdx = getColIdx(['title', 'chức vụ']);
        const supervisorIdx = getColIdx(['supervisor']);
        const genderIdx = getColIdx(['gender', 'sex', 'giới tính']);
        const vendorIdx = getColIdx(['detail vendor', 'vendor']);
        const zoneIdx = getColIdx(['zone', 'khu vực']);
        const muIdx = getColIdx(['mu']);
        const shiftLeaderIdx = getColIdx(['shift leader']);
        const statusIdx = getColIdx(['status', 'tình trạng']);
        const oldLeaderIdx = getColIdx(['old line leader']);
        const newLineIdx = getColIdx(['new line', 'location']);

        // Find date columns dynamically based on ANY DD-MMM header
        const dateCols: { idx: number, dateStr: string }[] = [];
        headers.forEach((h, idx) => {
            const match = h.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
            const isoMatch = h.match(/^\d{4}-\d{2}-\d{2}$/);
            if(match) {
                const d = parseInt(match[1]);
                const mStr = match[2].toLowerCase();
                const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                const mIdx = mNames.indexOf(mStr);
                const dateObj = new Date(2026, mIdx, d);
                dateCols.push({ idx, dateStr: format(dateObj, 'yyyy-MM-dd') });
            } else if (isoMatch) {
                dateCols.push({ idx, dateStr: h });
            }
        });

        const otMap: Record<string, Record<string, number>> = {};
        if (otSheet) {
            const rawOt = XLSX.utils.sheet_to_json(otSheet, { header: 1, raw: false, dateNF: 'd-mmm' }) as any[][];
            let otHeadIdx = 0;
            let otEmpIdx = -1;
            for(let i=0; i<Math.min(rawOt.length, 15); i++){
                const idx = rawOt[i].findIndex(c => String(c||'').toLowerCase().includes('employee code') || String(c||'').toLowerCase() === 'emp code');
                if(idx !== -1) { otEmpIdx = idx; otHeadIdx = i; break; }
            }
            if(otEmpIdx !== -1) {
                const otHeaders = rawOt[otHeadIdx].map(h => String(h||'').trim());
                const otDateCols: {idx: number, date: string}[] = [];
                otHeaders.forEach((h, idx) => {
                    const match = h.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
                    const isoMatch = h.match(/^\d{4}-\d{2}-\d{2}$/);
                    if(match) {
                        const d = parseInt(match[1]);
                        const mStr = match[2].toLowerCase();
                        const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                        const dateObj = new Date(2026, mNames.indexOf(mStr), d);
                        otDateCols.push({idx, date: format(dateObj, 'yyyy-MM-dd')});
                    } else if (isoMatch) {
                        otDateCols.push({ idx, date: h });
                    }
                });
                for(let i = otHeadIdx + 1; i < rawOt.length; i++){
                    const row = rawOt[i];
                    const code = String(row[otEmpIdx] || '').replace(/\$/g, '').trim();
                    if(!code || isNaN(parseInt(code))) continue;
                    if(!otMap[code]) otMap[code] = {};
                    otDateCols.forEach(dc => {
                        const v = parseFloat(String(row[dc.idx] || 0).replace(/\$/g, ''));
                        if(!isNaN(v) && v > 0) otMap[code][dc.date] = v;
                    });
                }
            }
        }

        let dbEmpMap = new Map<string, number>();
        try {
            const allEmployees = await prisma.employee.findMany({ select: { id: true, employeeCode: true } });
            dbEmpMap = new Map(allEmployees.map(e => [e.employeeCode, e.id]));
        } catch (e) {
            console.warn('Database unreachable, using mock IDs');
        }

        const results = [];
        const processedCodes = new Set<string>();

        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || !row[empCodeIdx]) continue;
            
            const rawCode = String(row[empCodeIdx]).replace(/\$/g, '').trim();
            if(!rawCode || rawCode.length < 3 || isNaN(parseInt(rawCode))) continue;
            if(processedCodes.has(rawCode)) continue;
            processedCodes.add(rawCode);

            const fullName = String(row[fullNameIdx] || 'Unknown').trim();
            const leaderName = String(row[leaderIdx] || 'N/A').trim();
            
            const attendanceMap: Record<string, string> = {};
            dateCols.forEach(col => {
                const val = (row[col.idx] || '').toString().trim().toUpperCase();
                if (val) attendanceMap[col.dateStr] = val === 'P' ? 'S1' : val;
            });

            results.push({
                id: dbEmpMap.get(rawCode) || (1000000 + i),
                employeeCode: rawCode,
                fullName,
                leaderName,
                pic: picIdx !== -1 ? String(row[picIdx] || '') : '',
                mgt: mgtIdx !== -1 ? String(row[mgtIdx] || '') : '',
                employeeType: typeIdx !== -1 ? String(row[typeIdx] || '') : '',
                title: titleIdx !== -1 ? String(row[titleIdx] || '') : '',
                supervisor: supervisorIdx !== -1 ? String(row[supervisorIdx] || '') : '',
                gender: genderIdx !== -1 ? String(row[genderIdx] || '') : '',
                vendor: vendorIdx !== -1 ? String(row[vendorIdx] || '') : '',
                zone: zoneIdx !== -1 ? String(row[zoneIdx] || '') : '',
                mu: muIdx !== -1 ? String(row[muIdx] || '') : '',
                shiftLeader: shiftLeaderIdx !== -1 ? String(row[shiftLeaderIdx] || '') : '',
                oldLineLeader: oldLeaderIdx !== -1 ? String(row[oldLeaderIdx] || '') : '',
                newLine: newLineIdx !== -1 ? String(row[newLineIdx] || '') : '',
                status: statusIdx !== -1 ? String(row[statusIdx] || 'Active') : 'Active',
                clerkAttendances: attendanceMap,
                clerkOvertimes: otMap[rawCode] || {},
                attendances: attendanceMap,
                overtimes: otMap[rawCode] || {}
            });
        }

        if (leaderId) {
            console.log('Filtering by leaderId:', leaderId);
            try {
                const leader = await prisma.user.findUnique({ where: { id: parseInt(leaderId) } });
                if (leader) {
                    return results.filter(r => r.leaderName.toLowerCase() === leader.fullName.toLowerCase());
                }
            } catch (e) {
                console.warn('Leader lookup failed, returning filtered results by name match if possible');
            }
        }

        console.log(`Successfully returned ${results.length} unique employees for April 2026`);
        return results;
    } catch (error: any) {
        console.error('getAprilExcelData Error:', error.message);
        throw error;
    }
}

export async function getMonthExcelData(targetMonth: string) {
    const [yearStr, monthStr] = targetMonth.split('-');
    const targetYear = parseInt(yearStr);
    const targetMonthIndex = parseInt(monthStr) - 1; // 0-based

    const baseDir = 'V:\\Production\\Share\\PT Tool\\01.Sản xuất MIL-Console-Clerk Team\\01. Chấm Công_Attendance\\01. BCC Console';
    if (!fs.existsSync(baseDir)) {
        throw new Error(`Base directory does not exist or network drive not accessible: ${baseDir}`);
    }

    // 1. Find Year folder
    const yearSubdirs = fs.readdirSync(baseDir).filter(f => f.includes(yearStr) && fs.statSync(path.join(baseDir, f)).isDirectory());
    if (yearSubdirs.length === 0) {
        throw new Error(`Cannot find folder for year ${yearStr}`);
    }
    const yearFolder = path.join(baseDir, yearSubdirs[0]);

    // 2. Find Month folder
    const monthSubdirs = fs.readdirSync(yearFolder).filter(f => {
        const isDir = fs.statSync(path.join(yearFolder, f)).isDirectory();
        if (!isDir) return false;
        const clean = f.toLowerCase();
        return clean.includes(`t${monthStr}`) || 
               clean.includes(`t${parseInt(monthStr)}`) || 
               clean.startsWith(`${monthStr}.`) || 
               clean.startsWith(`${parseInt(monthStr)}.`);
    });
    if (monthSubdirs.length === 0) {
        throw new Error(`Cannot find folder for month ${monthStr} in ${yearFolder}`);
    }
    const monthFolder = path.join(yearFolder, monthSubdirs[0]);

    // 3. Find files
    const files = fs.readdirSync(monthFolder).filter(f => {
        const isFile = fs.statSync(path.join(monthFolder, f)).isFile();
        return isFile && f.endsWith('.xlsx') && !f.startsWith('~$');
    });

    if (files.length === 0) {
        throw new Error(`No Excel files found in ${monthFolder}`);
    }

    console.log(`[sync-excel] Found files for ${targetMonth}:`, files);

    // Calculate dates in cycle
    let prevYear = targetYear;
    let prevMonthIndex = targetMonthIndex - 1;
    if (prevMonthIndex < 0) {
        prevMonthIndex = 11;
        prevYear -= 1;
    }
    const cycleStart = new Date(prevYear, prevMonthIndex, 21, 12, 0, 0);
    const cycleEnd = new Date(targetYear, targetMonthIndex, 20, 12, 0, 0);
    const daysInCycle = eachDayOfInterval({ start: cycleStart, end: cycleEnd });

    const recordsMap = new Map<string, any>();

    for (const file of files) {
        const filePath = path.join(monthFolder, file);
        console.log(`[sync-excel] Reading file: ${filePath}`);
        const fileBuffer = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true, dateNF: 'yyyy-mm-dd' });

        const tsSheetName = workbook.SheetNames.find(n => n.toUpperCase().trim() === 'TS') 
                            || workbook.SheetNames.find(n => n.toLowerCase().includes('attendance')) 
                            || workbook.SheetNames[0];
        const otSheetName = workbook.SheetNames.find(n => n.toUpperCase().trim() === 'OT' || n.toLowerCase().includes('ot'));

        const tsSheet = workbook.Sheets[tsSheetName];
        if (!tsSheet) continue;

        const rawData = XLSX.utils.sheet_to_json(tsSheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' }) as any[][];
        if (!rawData || rawData.length < 2) continue;

        let headerRowIndex = 0;
        let empCodeIdx = -1;
        for (let i = 0; i < Math.min(rawData.length, 30); i++) {
            const row = rawData[i];
            if (!row) continue;
            const idx = row.findIndex(cell => {
                const s = String(cell || '').toLowerCase().trim();
                return s === 'employee code' || s === 'mã nv' || s === 'emp code' || s === 'mã nhân viên';
            });
            if (idx !== -1) {
                empCodeIdx = idx;
                headerRowIndex = i;
                break;
            }
        }

        if (empCodeIdx === -1) continue;

        const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
        const getColIdx = (aliases: string[]) => {
            const lowerAliases = aliases.map(a => a.toLowerCase());
            return headers.findIndex(h => h && lowerAliases.includes(h.toLowerCase()));
        };

        const fullNameIdx = getColIdx(['full name', 'họ và tên', 'họ tên', 'name']);
        const leaderIdx = getColIdx(['line leader', 'contact person', 'supervisor', 'leader', 'new leader']);
        const picIdx = getColIdx(['pic']);
        const mgtIdx = getColIdx(['mgt (group)', 'mgt', 'mode', 'group']);
        const typeIdx = getColIdx(['type', 'employment type', 'loại']);
        const titleIdx = getColIdx(['title', 'chức vụ']);
        const supervisorIdx = getColIdx(['supervisor']);
        const genderIdx = getColIdx(['gender', 'sex', 'giới tính']);
        const vendorIdx = getColIdx(['detail vendor', 'vendor']);
        const zoneIdx = getColIdx(['zone', 'khu vực']);
        const muIdx = getColIdx(['mu']);
        const shiftLeaderIdx = getColIdx(['shift leader']);
        const statusIdx = getColIdx(['status', 'tình trạng']);
        const joinDateIdx = getColIdx(['joining date', 'start date']);
        const resignDateIdx = getColIdx(['last working date', 'end date']);
        const deptIdx = getColIdx(['dept', 'department', 'level 1']);
        const lineIdx = getColIdx(['line', 'location', 'level 4']);

        const dateCols: { idx: number, dateStr: string }[] = [];
        headers.forEach((h, idx) => {
            const match = h.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
            const isoMatch = h.match(/^\d{4}-\d{2}-\d{2}$/);
            const mdyMatch = h.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (match) {
                const day = parseInt(match[1]);
                const mStr = match[2].toLowerCase();
                const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                const mIdx = mNames.indexOf(mStr);
                const matchedDate = daysInCycle.find(d => d.getDate() === day && d.getMonth() === mIdx);
                if (matchedDate) {
                    dateCols.push({ idx, dateStr: format(matchedDate, 'yyyy-MM-dd') });
                }
            } else if (isoMatch) {
                dateCols.push({ idx, dateStr: h });
            } else if (mdyMatch) {
                const m = parseInt(mdyMatch[1]) - 1;
                const d = parseInt(mdyMatch[2]);
                const y = parseInt(mdyMatch[3]);
                const dObj = new Date(y, m, d);
                if (!isNaN(dObj.getTime())) {
                    dateCols.push({ idx, dateStr: format(dObj, 'yyyy-MM-dd') });
                }
            }
        });

        // OT
        const otMap: Record<string, Record<string, number>> = {};
        if (otSheetName) {
            const otSheet = workbook.Sheets[otSheetName];
            if (otSheet) {
                const rawOt = XLSX.utils.sheet_to_json(otSheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' }) as any[][];
                let otHeadIdx = 0;
                let otEmpIdx = -1;
                for (let i = 0; i < Math.min(rawOt.length, 15); i++) {
                    const idx = rawOt[i].findIndex(c => String(c || '').toLowerCase().includes('employee code') || String(c || '').toLowerCase() === 'emp code');
                    if (idx !== -1) { otEmpIdx = idx; otHeadIdx = i; break; }
                }
                if (otEmpIdx !== -1) {
                    const otHeaders = rawOt[otHeadIdx].map(h => String(h || '').trim());
                    const otDateCols: { idx: number, date: string }[] = [];
                    otHeaders.forEach((h, idx) => {
                        const match = h.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
                        const isoMatch = h.match(/^\d{4}-\d{2}-\d{2}$/);
                        const mdyMatch = h.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                        if (match) {
                            const day = parseInt(match[1]);
                            const mStr = match[2].toLowerCase();
                            const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                            const matchedDate = daysInCycle.find(d => d.getDate() === day && d.getMonth() === mNames.indexOf(mStr));
                            if (matchedDate) {
                                otDateCols.push({ idx, date: format(matchedDate, 'yyyy-MM-dd') });
                            }
                        } else if (isoMatch) {
                            otDateCols.push({ idx, date: h });
                        } else if (mdyMatch) {
                            const m = parseInt(mdyMatch[1]) - 1;
                            const d = parseInt(mdyMatch[2]);
                            const y = parseInt(mdyMatch[3]);
                            const dObj = new Date(y, m, d);
                            if (!isNaN(dObj.getTime())) {
                                otDateCols.push({ idx, date: format(dObj, 'yyyy-MM-dd') });
                            }
                        }
                    });
                    for (let i = otHeadIdx + 1; i < rawOt.length; i++) {
                        const row = rawOt[i];
                        const code = String(row[otEmpIdx] || '').replace(/\$/g, '').trim();
                        if (!code || isNaN(parseInt(code))) continue;
                        if (!otMap[code]) otMap[code] = {};
                        otDateCols.forEach(dc => {
                            const v = parseFloat(String(row[dc.idx] || 0).replace(/\$/g, ''));
                            if (!isNaN(v) && v > 0) otMap[code][dc.date] = v;
                        });
                    }
                }
            }
        }

        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || !row[empCodeIdx]) continue;

            const rawCode = String(row[empCodeIdx]).replace(/\$/g, '').trim();
            if (!rawCode || isNaN(parseInt(rawCode))) continue;

            const fullName = String(row[fullNameIdx] || 'Unknown').trim();
            const leaderName = String(row[leaderIdx] || 'N/A').trim();
            if (!rawCode || !leaderName) continue;

            const attendanceMap: Record<string, string> = {};
            dateCols.forEach(col => {
                const val = (row[col.idx] || '').toString().trim().toUpperCase();
                if (val) attendanceMap[col.dateStr] = val === 'P' ? 'S1' : val;
            });

            const existing = recordsMap.get(rawCode);
            if (existing) {
                // Merge attendances and overtimes
                Object.assign(existing.dailyData, attendanceMap);
                if (otMap[rawCode]) {
                    Object.assign(existing.otData, otMap[rawCode]);
                }
            } else {
                recordsMap.set(rawCode, {
                    employeeCode: rawCode,
                    fullName,
                    lineLeaderName: leaderName,
                    pic: picIdx !== -1 ? String(row[picIdx] || '').trim() : '',
                    mgt: mgtIdx !== -1 ? String(row[mgtIdx] || '').trim() : '',
                    employeeType: typeIdx !== -1 ? String(row[typeIdx] || '').trim() : '',
                    title: titleIdx !== -1 ? String(row[titleIdx] || '').trim() : '',
                    supervisor: supervisorIdx !== -1 ? String(row[supervisorIdx] || '').trim() : '',
                    gender: genderIdx !== -1 ? String(row[genderIdx] || '').trim() : '',
                    vendor: vendorIdx !== -1 ? String(row[vendorIdx] || '').trim() : '',
                    zone: zoneIdx !== -1 ? String(row[zoneIdx] || '').trim() : '',
                    mu: muIdx !== -1 ? String(row[muIdx] || '').trim() : '',
                    shiftLeader: shiftLeaderIdx !== -1 ? String(row[shiftLeaderIdx] || '').trim() : '',
                    status: statusIdx !== -1 ? String(row[statusIdx] || 'Active').trim() : 'Active',
                    joinDate: joinDateIdx !== -1 ? String(row[joinDateIdx] || '').trim() : '',
                    resignDate: resignDateIdx !== -1 ? String(row[resignDateIdx] || '').trim() : '',
                    department: deptIdx !== -1 ? String(row[deptIdx] || '').trim() : '',
                    line: lineIdx !== -1 ? String(row[lineIdx] || '').trim() : '',
                    dailyData: attendanceMap,
                    otData: otMap[rawCode] || {}
                });
            }
        }
    }

    return Array.from(recordsMap.values());
}
