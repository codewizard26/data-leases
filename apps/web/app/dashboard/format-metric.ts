/** Format exact decimal strings without converting monetary values to floating point. */
export function formatMetric(value:string,unit:string):{value:string;unit:string;approximate:boolean;exact:string}{
 const raw=unit.match(/^(USDC|USD|WETH|RATIO)_RAW_(\d+)_DECIMALS$/);
 const decimals=raw?Number(raw[2]):unit==='BASIS_POINTS'?2:0;
 const displayUnit=raw?(raw[1]==='RATIO'?'ratio':raw[1]):unit==='BASIS_POINTS'?'%':unit==='decimal-places'?'decimal places':unit.replaceAll('_',' ').toLowerCase();
 if(!/^-?\d+(\.\d+)?$/.test(value)||decimals>36||(decimals>0&&value.includes('.')))return {value,unit:displayUnit,approximate:false,exact:value};
 const negative=value.startsWith('-'),unsigned=negative?value.slice(1):value;
 let whole:string,fraction:string;
 if(decimals){const padded=unsigned.padStart(decimals+1,'0');whole=padded.slice(0,-decimals);fraction=padded.slice(-decimals);}else{[whole,fraction='']=unsigned.split('.');}
 whole=whole.replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
 fraction=fraction.replace(/0+$/,'');
 const prefix=negative?'-':'',exact=prefix+whole+(fraction?'.'+fraction:'');
 // Keep very small nonzero values visible instead of rendering them as zero.
 const limit=raw&&raw[1]!=='RATIO'?6:8;
 const approximate=fraction.length>limit&&/[1-9]/.test(fraction.slice(limit))&&/[1-9]/.test(whole.replaceAll(',','')+fraction.slice(0,limit));
 const shown=approximate?fraction.slice(0,limit).replace(/0+$/,''):fraction;
 return {value:prefix+whole+(shown?'.'+shown:''),unit:displayUnit,approximate,exact};
}
