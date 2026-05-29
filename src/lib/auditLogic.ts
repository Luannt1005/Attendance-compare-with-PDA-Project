import { parse, differenceInMinutes, addDays, isAfter } from 'date-fns'

// Convert "HH:mm" to Date object based on a baseDate
export function parseTimeStr(timeStr: string, baseDate: Date, isNextDay = false): Date {
    const d = parse(timeStr, 'HH:mm', baseDate)
    return isNextDay ? addDays(d, 1) : d
}

// Extract IN: and OUT: from "IN: 05:43, OUT: 17:41"
export function extractInOut(timeString: string): { inTime: string | null, outTime: string | null } {
    const inMatch = timeString.match(/IN:\s*(\d{2}:\d{2})/)
    const outMatch = timeString.match(/OUT:\s*(\d{2}:\d{2})/)
    return {
        inTime: inMatch ? inMatch[1] : null,
        outTime: outMatch ? outMatch[1] : null
    }
}

// Calculate overlap hours between two time ranges
export function getOverlapHours(actIn: Date, actOut: Date, reqIn: Date, reqOut: Date): number {
    const overlapStart = actIn > reqIn ? actIn : reqIn
    const overlapEnd = actOut < reqOut ? actOut : reqOut
    if (isAfter(overlapStart, overlapEnd)) return 0
    const mins = differenceInMinutes(overlapEnd, overlapStart)
    // Round to nearest 0.25 (15 mins)
    return Math.floor(mins / 15) * 0.25
}

export function verifyRecord(
    empCode: string,
    fullName: string,
    leaderName: string,
    submittedShift: string,
    submittedOt: number,
    realInStr: string | null,
    realOutStr: string | null,
    baseDate: Date,
    shiftConfigStr: Record<string, { start: string, end: string, otPre?: [string, string], otPost?: [string, string] }>,
    extraFields?: { pic?: string | null, mgt?: string | null, employeeType?: string | null, supervisor?: string | null }
) {
    let status: 'VALID' | 'WARNING' | 'ERROR' = 'VALID'
    let reason = ''
    let expectedOt = 0
    const dateStr = baseDate.toISOString().split('T')[0]

    // Auto-valid logic for Staff/Clerk
    const isAutoValid = extraFields?.employeeType?.toLowerCase() === 'staff' ||
        extraFields?.mgt?.toLowerCase() === 'clerk';

    const isLeaveOrEmpty = !submittedShift || !shiftConfigStr[submittedShift]
    const hasFingerprint = realInStr || realOutStr

    if (isLeaveOrEmpty) {
        if (realInStr && realOutStr) {
            status = 'ERROR'
            reason = 'Op thực tế có đi làm (đủ IN/OUT) nhưng Leader không chấm ca hoặc chấm Phép.'
        } else if (hasFingerprint) {
            status = 'WARNING'
            reason = `Phát hiện vân tay lẻ (${realInStr || realOutStr}) vào ngày nghỉ. Có thể là quẹt nhầm hoặc dữ liệu rác.`
        } else {
            status = 'VALID'
            reason = 'Nghỉ hoặc phép hợp lệ (Không có vân tay).'
        }
        return {
            employeeCode: empCode,
            fullName,
            leaderName,
            submittedShift: submittedShift || 'Leave/Empty',
            submittedOt,
            realIn: realInStr,
            realOut: realOutStr,
            expectedOt: '-',
            status,
            reason,
            pic: extraFields?.pic,
            mgt: extraFields?.mgt,
            employeeType: extraFields?.employeeType,
            supervisor: extraFields?.supervisor,
            date: dateStr
        }
    }

    if (isAutoValid) {
        return {
            employeeCode: empCode,
            fullName,
            leaderName,
            submittedShift,
            submittedOt,
            realIn: realInStr,
            realOut: realOutStr,
            expectedOt: '-',
            status: 'VALID',
            reason: 'Miễn kiểm tra (Nhân viên Staff hoặc Clerk).',
            pic: extraFields?.pic,
            mgt: extraFields?.mgt,
            employeeType: extraFields?.employeeType,
            supervisor: extraFields?.supervisor,
            date: dateStr
        }
    }

    if (!hasFingerprint) {
        status = 'ERROR'
        reason = `Được chấm ca ${submittedShift} nhưng không có dữ liệu vân tay IN/OUT.`
        return {
            employeeCode: empCode,
            fullName,
            leaderName,
            submittedShift,
            submittedOt,
            realIn: realInStr,
            realOut: realOutStr,
            expectedOt: '-',
            status,
            reason,
            pic: extraFields?.pic,
            mgt: extraFields?.mgt,
            employeeType: extraFields?.employeeType,
            supervisor: extraFields?.supervisor,
            date: dateStr
        }
    }

    if (!realInStr || !realOutStr) {
        status = 'ERROR'
        reason = `Thiếu giờ ${!realInStr ? 'IN' : 'OUT'}. Quên quẹt thẻ.`
        return {
            employeeCode: empCode,
            fullName,
            leaderName,
            submittedShift,
            submittedOt,
            realIn: realInStr,
            realOut: realOutStr,
            expectedOt: '-',
            status,
            reason,
            pic: extraFields?.pic,
            mgt: extraFields?.mgt,
            employeeType: extraFields?.employeeType,
            supervisor: extraFields?.supervisor,
            date: dateStr
        }
    }

    const conf = shiftConfigStr[submittedShift]
    let actIn = parseTimeStr(realInStr, baseDate)
    let actOut = parseTimeStr(realOutStr, baseDate)

    let reqIn = parseTimeStr(conf.start, baseDate)
    let reqOut = parseTimeStr(conf.end, baseDate)

    // Check if the shift crosses midnight
    const isNightShift = reqOut < reqIn;

    // Detect if actual fingerprint indicates a night shift based solely on the IN hour
    const actInHour = actIn.getHours();
    const actualIsNight = (actInHour >= 16 || actInHour < 4);

    if (isNightShift !== actualIsNight) {
        status = 'ERROR'
        reason = `Chấm sai ca. Vân tay thực tế là ca ${actualIsNight ? 'đêm' : 'ngày'} nhưng Leader đăng ký ca ${isNightShift ? 'đêm' : 'ngày'} (${submittedShift}).`
        return {
            employeeCode: empCode,
            fullName,
            leaderName,
            submittedShift,
            submittedOt,
            realIn: realInStr,
            realOut: realOutStr,
            expectedOt: '-',
            status,
            reason,
            pic: extraFields?.pic,
            mgt: extraFields?.mgt,
            employeeType: extraFields?.employeeType,
            supervisor: extraFields?.supervisor,
            date: dateStr
        }
    }

    if (isNightShift) {
        reqOut = addDays(reqOut, 1)
        // Any fingerprint before 15:00 for a night shift is considered the next day's morning
        if (actIn.getHours() < 15) actIn = addDays(actIn, 1)
        if (actOut.getHours() < 15) actOut = addDays(actOut, 1)
    }

    // Fallback logic for normal shifts crossing midnight via OT
    if (actOut < actIn) {
        actOut = addDays(actOut, 1)
    }

    // 1. Shift validation
    // Tolerances: 30 minutes early/late acceptable for shift start/end detection loosely
    // If they were completely off, flag wrong shift
    const inDiff = Math.abs(differenceInMinutes(actIn, reqIn))
    const outDiff = Math.abs(differenceInMinutes(actOut, reqOut))

    // Loosely check if they are way off the shift core bounds
    if ((actOut < reqIn) || (actIn > reqOut) || (inDiff > 240 && outDiff > 240)) {
        status = 'ERROR'
        reason = `Giờ vân tay không nằm trong khung giờ của ca ${submittedShift} (${conf.start}-${conf.end}). Chấm sai ca.`
        return {
            employeeCode: empCode,
            fullName,
            leaderName,
            submittedShift,
            submittedOt,
            realIn: realInStr,
            realOut: realOutStr,
            expectedOt: '-',
            status,
            reason,
            pic: extraFields?.pic,
            mgt: extraFields?.mgt,
            employeeType: extraFields?.employeeType,
            supervisor: extraFields?.supervisor,
            date: dateStr
        }
    } else if (inDiff > 120 && outDiff > 120) {
        status = 'WARNING'
        reason = `Giờ bắt đầu/kết thúc lệch quá 2 tiếng so với ca ${submittedShift}.`
    }

    // 2. OT Calculation
    if (conf.otPre) {
        let preStart = parseTimeStr(conf.otPre[0], baseDate)
        let preEnd = parseTimeStr(conf.otPre[1], baseDate)
        // If preEnd is 06:00 and preStart is 18:00 (cross day)
        if (preEnd < preStart) preEnd = addDays(preEnd, 1)

        expectedOt += getOverlapHours(actIn, actOut, preStart, preEnd)
    }

    if (conf.otPost) {
        let postStart = parseTimeStr(conf.otPost[0], baseDate)
        let postEnd = parseTimeStr(conf.otPost[1], baseDate)
        if (postEnd < postStart) postEnd = addDays(postEnd, 1)

        // If shift is a night shift, the post OT period takes place the next day 
        if (isNightShift && postStart.getHours() < 15) {
            postStart = addDays(postStart, 1)
            postEnd = addDays(postEnd, 1)
        }

        expectedOt += getOverlapHours(actIn, actOut, postStart, postEnd)
    }

    if (Math.abs(expectedOt - submittedOt) > 0.75) {
        status = 'ERROR'
        reason = (reason ? reason + ' ' : '') + `Giờ OT submit (${submittedOt}) mâu thuẫn với thực tế tính toán (${expectedOt}h).`
    } else if (Math.abs(expectedOt - submittedOt) > 0) {
        status = 'WARNING'
        reason = (reason ? reason + ' ' : '') + `Lệch nhỏ giữa OT submit (${submittedOt}) và tính toán (${expectedOt}h).`
    }

    let finalInStr = realInStr
    let finalOutStr = realOutStr

    if (realInStr && actIn && actIn.getDate() !== baseDate.getDate()) {
        finalInStr += ' (+1d)'
    }

    if (realOutStr && actOut && actOut.getDate() !== baseDate.getDate()) {
        finalOutStr += ' (+1d)'
    }

    return {
        employeeCode: empCode,
        fullName,
        leaderName,
        submittedShift,
        submittedOt,
        realIn: finalInStr,
        realOut: finalOutStr,
        expectedOt,
        status,
        reason,
        pic: extraFields?.pic,
        mgt: extraFields?.mgt,
        employeeType: extraFields?.employeeType,
        supervisor: extraFields?.supervisor,
        date: dateStr
    }
}
