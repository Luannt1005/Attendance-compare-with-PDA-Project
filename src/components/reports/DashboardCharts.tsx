'use client'

import React from 'react'
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    BarChart, Bar,
    PieChart, Pie, Cell, LabelList
} from 'recharts'

const MODERN_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#6366f1']

const TooltipStyle = {
    borderRadius: '16px',
    border: 'none',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    fontSize: '12px',
    fontWeight: 'bold',
}

const XAxisProps = {
    tick: { fontSize: 10, fontWeight: 'bold' as 'bold', fill: '#94a3b8' },
    axisLine: false,
    tickLine: false,
}

const YAxisProps = {
    tick: { fontSize: 10, fill: '#94a3b8' },
    axisLine: false,
    tickLine: false,
}

const GridProps = {
    strokeDasharray: "3 3",
    vertical: false, 
    stroke: "#f1f5f9"
}

const LabelProps = {
    position: 'top' as const,
    style: { fontSize: '10px', fontWeight: 'bold', fill: '#64748b' },
    offset: 8
}

const StackedLabelProps = {
    position: 'center' as const,
    style: { fontSize: '9px', fontWeight: 'bold', fill: '#fff' }
}

export function DailyAttendanceChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <NoData />
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 25, right: 30, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="barPresent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                        <stop offset="100%" stopColor="#059669" stopOpacity={0.8} />
                    </linearGradient>
                    <linearGradient id="barAbsent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                        <stop offset="100%" stopColor="#d97706" stopOpacity={0.8} />
                    </linearGradient>
                </defs>
                <CartesianGrid {...GridProps} />
                <XAxis dataKey="date" {...XAxisProps} />
                <YAxis {...YAxisProps} />
                <Tooltip cursor={{ fill: 'rgba(226, 232, 240, 0.4)' }} contentStyle={TooltipStyle} />
                <Bar dataKey="Present" stackId="a" fill="url(#barPresent)">
                    <LabelList dataKey="Present" {...StackedLabelProps} />
                </Bar>
                <Bar dataKey="Absent" stackId="a" fill="url(#barAbsent)" radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="Absent" {...StackedLabelProps} />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    )
}

export function DailyOvertimeChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <NoData />
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 25, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid {...GridProps} />
                <XAxis dataKey="date" {...XAxisProps} />
                <YAxis {...YAxisProps} />
                <Tooltip cursor={{ fill: 'rgba(226, 232, 240, 0.4)' }} contentStyle={TooltipStyle} />
                <Bar dataKey="OT 1.5" stackId="a" fill="#3b82f6" />
                <Bar dataKey="OT 2.0" stackId="a" fill="#8b5cf6" />
                <Bar dataKey="OT 2.5" stackId="a" fill="#ec4899" />
                <Bar dataKey="OT 3.0" stackId="a" fill="#f43f5e" radius={[6, 6, 0, 0]} />
                <Bar dataKey="total" hide>
                    <LabelList dataKey={(d: any) => (d['OT 1.5'] + d['OT 2.0'] + d['OT 2.5'] + d['OT 3.0']).toFixed(1)} {...LabelProps} />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    )
}

export function LeaveDistributionChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <NoData />
    return (
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="45%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                    cornerRadius={6}
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={true}
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={MODERN_COLORS[index % MODERN_COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip contentStyle={TooltipStyle} />
                <Legend layout="horizontal" verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', paddingTop: '20px' }} />
            </PieChart>
        </ResponsiveContainer>
    )
}

export function DailyOtComparisonChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <NoData />
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 25, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid {...GridProps} />
                <XAxis dataKey="date" {...XAxisProps} />
                <YAxis {...YAxisProps} />
                <Tooltip cursor={{ fill: 'rgba(226, 232, 240, 0.4)' }} contentStyle={TooltipStyle} />
                <Bar dataKey="submittedOT" name="Submitted OT" fill="#f59e0b" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="submittedOT" {...LabelProps} />
                </Bar>
                <Bar dataKey="calculatedOT" name="Fingerprint OT" fill="#6366f1" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="calculatedOT" {...LabelProps} />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    )
}

export function OtComparisonLineChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <NoData />
    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 25, right: 30, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorSub" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff7754" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ff7754" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorCalc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2f9871" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2f9871" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid {...GridProps} />
                <XAxis dataKey="date" {...XAxisProps} />
                <YAxis {...YAxisProps} />
                <Tooltip contentStyle={TooltipStyle} />
                <Area type="monotone" dataKey="submittedOT" name="Timesheet OT" stroke="#ff7754" strokeWidth={3} fillOpacity={1} fill="url(#colorSub)" dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} />
                <Area type="monotone" dataKey="calculatedOT" name="Fingerprint OT" stroke="#2f9871" strokeWidth={3} fillOpacity={1} fill="url(#colorCalc)" dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} />
            </AreaChart>
        </ResponsiveContainer>
    )
}

export function OtStatusPieChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <NoData />
    return <LeaveDistributionChart data={data} />
}

export function InconsistencyChart({ data }: { data: any[] }) {
    if (!data || data.length === 0) return <NoData />
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 25, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid {...GridProps} />
                <XAxis dataKey="date" {...XAxisProps} />
                <YAxis {...YAxisProps} />
                <Tooltip contentStyle={TooltipStyle} />
                <Bar dataKey="count" name="Issues" fill="#f43f5e" radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="count" {...LabelProps} />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    )
}

function NoData() {
    return (
        <div className="w-full h-full min-h-[200px] flex flex-col items-center justify-center text-gray-400 text-sm bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
            <span className="font-bold uppercase tracking-widest text-[10px] opacity-40">No Analytics Data</span>
        </div>
    )
}
