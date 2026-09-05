'use client';
import {useEffect,useState} from 'react';
import {Landmark} from 'lucide-react';
import {imageUrl,type LocalGuide} from '@/lib/local';
import type {Guide} from '@/lib/types';
export function ArtImage({guide,row,className=''}:{guide:Guide;row?:LocalGuide;className?:string}){
 const [url,setUrl]=useState<string|null>(imageUrl(guide));const [failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false);if(row?.offline&&row.imageBlob){const blob=URL.createObjectURL(row.imageBlob);setUrl(blob);return()=>URL.revokeObjectURL(blob);}setUrl(imageUrl(guide));},[guide.image,row?.imageBlob,row?.offline]);
 return <div className={'art-image '+className}>{url&&!failed?<img src={url} onError={()=>setFailed(true)} alt={`${guide.creator} · ${guide.title}`}/>:<div className="image-missing"><Landmark size={38}/><p>暂未找到可显示的作品图片</p><span>仍可阅读和收听介绍</span></div>}</div>;
}
