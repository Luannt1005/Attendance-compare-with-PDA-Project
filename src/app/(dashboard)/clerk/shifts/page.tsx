'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Edit2, Trash2, Clock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Shift {
    id: number
    code: string
    name: string | null
    startTime: string
    endTime: string
    otPreStart: string | null
    otPreEnd: string | null
    otPostStart: string | null
    otPostEnd: string | null
    isActive: boolean
}

export default function ShiftsPage() {
    const [shifts, setShifts] = useState<Shift[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)

    const [editingShift, setEditingShift] = useState<Partial<Shift> | null>(null)
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        setPortalNode(document.getElementById('timesheet-header-portal'))
        fetchShifts()
    }, [])

    const fetchShifts = async () => {
        setIsLoading(true)
        try {
            const res = await fetch('/api/shifts')
            const { data } = await res.json()
            setShifts(data)
        } catch (e) {
            console.error(e)
        } finally {
            setIsLoading(false)
        }
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingShift?.code || !editingShift.startTime || !editingShift.endTime) return
        setIsSaving(true)

        try {
            const isEditing = !!editingShift.id
            const url = isEditing ? `/api/shifts/${editingShift.id}` : '/api/shifts'
            const method = isEditing ? 'PUT' : 'POST'

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingShift)
            })

            if (!res.ok) throw new Error('Action failed')
            setEditingShift(null)
            fetchShifts()
        } catch (err: any) {
            alert("Lỗi khi lưu: " + err.message)
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async (id: number) => {
        if (!confirm('Bạn có chắc chắn muốn xóa Ca này? (Data lịch sử audit có thể không mapping được nữa)')) return
        try {
            await fetch(`/api/shifts/${id}`, { method: 'DELETE' })
            fetchShifts()
        } catch (e) {
            alert("Lỗi khi xoá")
        }
    }

    return (
        <div className="flex flex-col h-full bg-gray-50 max-w-6xl mx-auto w-full p-6">
            {portalNode && createPortal(
                <div className="flex flex-col">
                    <h1 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                        <Clock className="text-orange-500" size={20} /> Cấu hình Ca làm việc
                    </h1>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Định nghĩa thời gian làm việc và quy tắc tăng ca</p>
                </div>,
                portalNode
            )}

            <div className="flex justify-between items-center mb-6 px-4 py-2 bg-white rounded-xl border border-gray-100 shadow-sm">
                <div>
                    <h2 className="text-sm font-bold text-gray-800 uppercase tracking-tight">Danh sách Ca hiện có</h2>
                    <p className="text-[10px] text-gray-400 font-medium">Các ca này sẽ hiển thị trong bảng công để lựa chọn.</p>
                </div>
                <button
                    onClick={() => setEditingShift({ isActive: true })}
                    className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all font-bold text-[11px] shadow-sm uppercase tracking-widest active:scale-95"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Thêm ca mới
                </button>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                        <thead className="bg-gray-100 border-b border-gray-200 text-gray-500 font-bold uppercase text-[10px] tracking-widest">
                            <tr>
                                <th className="px-6 py-3">Mã Ca</th>
                                <th className="px-6 py-3">Tên Ca</th>
                                <th className="px-6 py-3">Giờ làm việc</th>
                                <th className="px-6 py-3">OT Đầu ca</th>
                                <th className="px-6 py-3">OT Cuối ca</th>
                                <th className="px-6 py-3">Trạng thái</th>
                                <th className="px-6 py-3 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {shifts.map(s => (
                                <tr key={s.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 font-bold text-gray-900">{s.code}</td>
                                    <td className="px-6 py-4 text-gray-600">{s.name || '-'}</td>
                                    <td className="px-6 py-4 font-mono text-blue-700 font-medium bg-blue-50/30">
                                        <div className="flex items-center gap-1.5 border border-blue-100 px-2 py-0.5 rounded-md self-start inline-flex">
                                            <Clock className="w-3.5 h-3.5 text-blue-500" />
                                            {s.startTime} - {s.endTime}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-purple-700 bg-purple-50/20">
                                        {s.otPreStart && s.otPreEnd ? `${s.otPreStart} - ${s.otPreEnd}` : '-'}
                                    </td>
                                    <td className="px-6 py-4 font-mono text-orange-700 bg-orange-50/20">
                                        {s.otPostStart && s.otPostEnd ? `${s.otPostStart} - ${s.otPostEnd}` : '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                        {s.isActive ? (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                                <Check className="w-3 h-3" /> Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                                Inactive
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => setEditingShift(s)} className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                                            <button onClick={() => handleDelete(s.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {editingShift && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-gray-900">{editingShift.id ? 'Edit Shift' : 'Create New Shift'}</h3>
                            <button onClick={() => setEditingShift(null)} className="text-gray-400 hover:text-gray-600 text-xl font-medium">&times;</button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 flex-1 overflow-y-auto space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Mã Ca *</label>
                                    <input required placeholder="VD: S6" value={editingShift.code || ''} onChange={e => setEditingShift({ ...editingShift, code: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-orange-100 focus:border-orange-400 outline-none transition-all shadow-sm" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tên Ca</label>
                                    <input placeholder="VD: Ca sáng" value={editingShift.name || ''} onChange={e => setEditingShift({ ...editingShift, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-orange-100 focus:border-orange-400 outline-none transition-all shadow-sm" />
                                </div>
                            </div>

                            <hr className="border-gray-100" />
                            <h4 className="text-sm font-semibold text-gray-800">Working Hours</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Start Time (HH:mm) *</label>
                                    <input required type="time" value={editingShift.startTime || ''} onChange={e => setEditingShift({ ...editingShift, startTime: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">End Time (HH:mm) *</label>
                                    <input required type="time" value={editingShift.endTime || ''} onChange={e => setEditingShift({ ...editingShift, endTime: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                                </div>
                            </div>

                            <hr className="border-gray-100" />
                            <h4 className="text-sm font-semibold text-purple-800">Pre-Shift OT Constraints</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">OT Valid From</label>
                                    <input type="time" value={editingShift.otPreStart || ''} onChange={e => setEditingShift({ ...editingShift, otPreStart: e.target.value })} className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none font-mono" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">OT Valid To</label>
                                    <input type="time" value={editingShift.otPreEnd || ''} onChange={e => setEditingShift({ ...editingShift, otPreEnd: e.target.value })} className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none font-mono" />
                                </div>
                            </div>

                            <hr className="border-gray-100" />
                            <h4 className="text-sm font-semibold text-orange-800">Post-Shift OT Constraints</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">OT Valid From</label>
                                    <input type="time" value={editingShift.otPostStart || ''} onChange={e => setEditingShift({ ...editingShift, otPostStart: e.target.value })} className="w-full border border-orange-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 outline-none font-mono" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">OT Valid To</label>
                                    <input type="time" value={editingShift.otPostEnd || ''} onChange={e => setEditingShift({ ...editingShift, otPostEnd: e.target.value })} className="w-full border border-orange-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 outline-none font-mono" />
                                </div>
                            </div>

                            <div className="mt-4 flex items-center gap-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={editingShift.isActive ?? true} onChange={e => setEditingShift({ ...editingShift, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    Active for Usage
                                </label>
                            </div>

                            <div className="pt-4 border-t border-gray-100 flex justify-end gap-3 mt-6">
                                <button type="button" onClick={() => setEditingShift(null)} className="px-4 py-2 text-[11px] font-bold text-gray-500 uppercase tracking-widest bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">Hủy</button>
                                <button type="submit" disabled={isSaving} className={cn("px-4 py-2 text-[11px] font-bold text-white uppercase tracking-widest bg-orange-500 rounded-xl hover:bg-orange-600 transition-all flex items-center gap-2 shadow-sm active:scale-95", isSaving && "opacity-50 pointer-events-none")}>
                                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    Lưu cấu hình
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
