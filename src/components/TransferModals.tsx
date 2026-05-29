import { useState, useEffect } from 'react'
import { X, Check, XCircle } from 'lucide-react'

export function SendTransferModal({ isOpen, onClose, selectedCount, onConfirm, currentMonth }: any) {
    const [leaders, setLeaders] = useState<any[]>([])
    const [targetLeader, setTargetLeader] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (isOpen) {
            fetch('/api/users/leaders')
                .then(res => res.json())
                .then(data => setLeaders(data.data || []))
        }
    }, [isOpen])

    if (!isOpen) return null

    const handleConfirm = async () => {
        if (!targetLeader) return alert('Select target leader')
        setLoading(true)
        await onConfirm(parseInt(targetLeader), currentMonth)
        setLoading(false)
        onClose()
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100">
            <div className="bg-white rounded-xl shadow-xl w-[400px] max-w-[90vw] flex flex-col overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-800">Send Transfer Request</h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
                </div>
                <div className="p-5 flex flex-col gap-4">
                    <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">Selected Employees: <span className="font-bold text-blue-600">{selectedCount}</span></p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Leader</label>
                        <select className="w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900"
                            value={targetLeader} onChange={e => setTargetLeader(e.target.value)}>
                            <option value="">Select Leader...</option>
                            {leaders.map(l => (
                                <option key={l.id} value={l.id}>{l.fullName} ({l.username})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Month</label>
                        <div className="w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-100 border text-gray-700 font-mono">
                            {currentMonth}
                        </div>
                    </div>
                </div>
                <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
                    <button onClick={onClose} className="px-4 py-2 font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
                    <button onClick={handleConfirm} disabled={loading || !targetLeader} className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
                        {loading ? 'Sending...' : 'Send Request'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export function IncomingTransfersModal({ isOpen, onClose, currentUserId }: any) {
    const [requests, setRequests] = useState<any[]>([])
    const [loading, setLoading] = useState(false)

    const fetchRequests = async () => {
        setLoading(true)
        const res = await fetch(`/api/transfer-requests?toLeaderId=${currentUserId}`)
        const json = await res.json()
        setRequests(json.data || [])
        setLoading(false)
    }

    useEffect(() => {
        if (isOpen) fetchRequests()
    }, [isOpen, currentUserId])

    const handleAction = async (id: number, action: string) => {
        if (!confirm(`Are you sure you want to ${action} this request?`)) return
        await fetch(`/api/transfer-requests/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: id, action })
        })
        fetchRequests()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100">
            <div className="bg-white rounded-xl shadow-xl w-[600px] max-w-[95vw] flex flex-col max-h-[80vh] overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-800">Incoming Transfer Requests</h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
                </div>
                <div className="p-0 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="p-8 text-center text-gray-500">Loading...</div>
                    ) : requests.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">No pending requests</div>
                    ) : (
                        <table className="w-full text-sm text-left text-gray-600 border-collapse">
                            <thead className="bg-gray-50 text-gray-700 sticky top-0 border-b">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Employee</th>
                                    <th className="px-4 py-3 font-semibold">From Leader</th>
                                    <th className="px-4 py-3 font-semibold">Month</th>
                                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {requests.map(r => (
                                    <tr key={r.id} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-3 font-medium text-gray-900">{r.employee.fullName} <span className="text-gray-400 font-mono text-xs">({r.employee.employeeCode})</span></td>
                                        <td className="px-4 py-3">{r.fromLeader.fullName}</td>
                                        <td className="px-4 py-3">{r.targetMonth}</td>
                                        <td className="px-4 py-3 flex gap-2 justify-end">
                                            <button onClick={() => handleAction(r.id, 'Approve')} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded bg-emerald-50/50 transition-colors" title="Approve"><Check className="w-4 h-4" /></button>
                                            <button onClick={() => handleAction(r.id, 'Reject')} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded bg-rose-50/50 transition-colors" title="Reject"><XCircle className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="px-5 py-4 border-t border-gray-100 flex justify-end bg-gray-50 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">Close</button>
                </div>
            </div>
        </div>
    )
}
