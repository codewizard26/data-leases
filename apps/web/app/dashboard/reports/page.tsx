import ReportsWorkspace from './reports-workspace';

export const metadata={title:'Previous analysis reports | Data Leases'};
export default async function ReportsPage({searchParams}:{searchParams:Promise<{runId?:string|string[]}>}){
 const params=await searchParams;
 return <ReportsWorkspace runId={typeof params.runId==='string'?params.runId:undefined}/>;
}
