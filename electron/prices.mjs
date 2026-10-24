import { catalog } from './catalog.mjs';
const permitted=new Set(['www.newegg.com','www.bestbuy.com','api.bestbuy.com']);
export function allowedUrl(value) { try {const u=new URL(value); return u.protocol==='https:'&&permitted.has(u.hostname)&&!u.username&&!u.password&&!u.port;}catch{return false;} }
export function parseNewegg(html,part,now=new Date().toISOString()) {
 for(const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  let data; try{data=JSON.parse(match[1]);}catch{continue;}
  const nodes=Array.isArray(data)?data:data['@graph']||[data];
  for(const p of nodes) {
   if(![p['@type']].flat().includes('Product')) continue;
   const identifiers=[p.sku,p.mpn,p.productID].filter(v=>typeof v==='string').map(v=>v.toLowerCase());
   if(!identifiers.includes(part.model.toLowerCase())&&!identifiers.includes(part.id.toLowerCase())) continue;
   for(const o of [p.offers].flat().filter(Boolean)) {
    if(o['@type']!=='Offer'||o.priceCurrency!=='USD'||!Number.isFinite(Number(o.price))||Number(o.price)<=0) continue;
    if(!o.seller?.name) continue; // Don't attribute marketplace prices to Newegg.
    if(!/\/InStock$/.test(o.availability||'')) continue;
    return {...part,url:`https://www.newegg.com/p/${part.id}`,price:Number(o.price),seller:o.seller.name,observedAt:now,source:'Live retailer structured data',inStock:true};
   }
  }
 }
 throw new Error('No unambiguous USD offer with matching model, stock and seller was available.');
}
async function textResponse(url) {
 if(!allowedUrl(url)) throw new Error('Unsupported retailer URL.');
 const response=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok) throw new Error(`Retailer returned HTTP ${response.status}.`);
 let length=0; const chunks=[];
 for await(const chunk of response.body) {length+=chunk.length;if(length>5_000_000) throw new Error('Retailer response too large.');chunks.push(chunk);}
 return Buffer.concat(chunks).toString('utf8');
}
export async function refreshPrices(existing=catalog,apiKey='') {
 const results=[];
 for(const part of existing) {
  try {
   if(apiKey) {
    const url=`https://api.bestbuy.com/v1/products(modelNumber="${encodeURIComponent(part.model)}")?apiKey=${encodeURIComponent(apiKey)}&format=json&show=name,modelNumber,salePrice,url,onlineAvailability,condition`;
    const body=JSON.parse(await textResponse(url));
    const found=body.products?.find(p=>p.modelNumber?.toLowerCase()===part.model.toLowerCase()&&p.onlineAvailability===true&&p.condition==='New'&&Number.isFinite(p.salePrice)&&p.salePrice>0&&allowedUrl(p.url));
    if(!found) throw new Error('No matching new, in-stock Best Buy offer.');
    results.push({...part,price:found.salePrice,url:found.url,seller:'Best Buy',observedAt:new Date().toISOString(),source:'Live Best Buy Products API',inStock:true,refreshError:null});
   } else {
    const html=await textResponse(`https://www.newegg.com/p/${part.id}`);
    results.push({...parseNewegg(html,part),refreshError:null});
   }
  } catch(error) {results.push({...part,refreshError:apiKey?'Best Buy did not return a verified offer. Check your key or try later.':error.message});}
 }
 return results;
}
