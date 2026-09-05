'use client';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
export function Picker({label,value,onChange,items}:{label:string;value:string;onChange:(s:string)=>void;items:{value:string;label:string}[]}){return <Select value={value} onValueChange={v=>v&&onChange(v)}><SelectTrigger aria-label={label}><SelectValue>{items.find(x=>x.value===value)?.label??value}</SelectValue></SelectTrigger><SelectContent>{items.map(i=><SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent></Select>;}
