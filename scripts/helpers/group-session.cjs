const assert=require('node:assert/strict');
module.exports=async(call,token,name)=>{
  const created=await call('/api/organizations',{method:'POST',token,body:{name,type:'business'}});
  assert.equal(created.status,200,JSON.stringify(created));
  const organizationId=created.data.organization._id;
  const switched=await call('/api/auth/switch-organization',{method:'POST',token,body:{organizationId}});
  assert.equal(switched.status,200,JSON.stringify(switched));
  return {organizationId,token:switched.data.tokens.accessToken};
};
