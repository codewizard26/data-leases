import {expect,it} from 'vitest';
import {formatMetric} from '../../apps/web/app/dashboard/format-metric.js';
it('scales and groups raw USDC without losing precision',()=>{
 expect(formatMetric('426079350326968','USDC_RAW_6_DECIMALS')).toEqual({value:'426,079,350.326968',unit:'USDC',approximate:false,exact:'426,079,350.326968'});
 expect(formatMetric('9007199254740993000001','USDC_RAW_6_DECIMALS').exact).toBe('9,007,199,254,740,993.000001');
});
it('formats percentages and keeps small values visible',()=>{
 expect(formatMetric('6750','BASIS_POINTS').value).toBe('67.5');
 expect(formatMetric('6750','BASIS_POINTS').unit).toBe('%');
 expect(formatMetric('1','WETH_RAW_18_DECIMALS').value).toBe('0.000000000000000001');
 expect(formatMetric('18','decimal-places').value).toBe('18');
});
it('marks shortened values and retains the exact amount',()=>{
 const result=formatMetric('1234567890123456789','WETH_RAW_18_DECIMALS');
 expect(result.value).toBe('1.234567');expect(result.approximate).toBe(true);expect(result.exact).toBe('1.234567890123456789');
 expect(formatMetric('not available','USDC_RAW_6_DECIMALS').value).toBe('not available');
});
