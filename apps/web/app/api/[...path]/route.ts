// Reached only when no gateway is configured (see next.config.ts): the hosted console has no backend yet.
export const dynamic='force-dynamic';
function unavailable(){
 return Response.json({error:'GATEWAY_NOT_CONFIGURED',message:'The agent gateway is not connected. Set GATEWAY_URL and redeploy.'},{status:503,headers:{'Cache-Control':'no-store'}});
}
export const GET=unavailable,POST=unavailable,PUT=unavailable,PATCH=unavailable,DELETE=unavailable;
