import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { hash, learningVersion } from '../shared/finance-learning.mjs';
export async function loadLearningBundle(db, bundle, expectedDataset = '') {
  const {bundleHash,...payload} = bundle, {dataset,rows,patterns} = payload;
  if (bundleHash !== hash(JSON.stringify(payload)) || dataset.version !== learningVersion || rows.length !== dataset.summary.rowCount || patterns.length !== dataset.summary.patternCount) throw Error('Incomplete or modified learning bundle');
  const ownerId = new ObjectId(dataset.ownerId);
  if (!await db.collection('users').findOne({_id:ownerId})) throw Error('Owner does not exist');
  for (const b of dataset.accountBindings) if (!await db.collection('financialaccounts').findOne({_id:new ObjectId(b.accountId),ownerId,active:true})) throw Error('Account binding is not owned and active');
  for (const a of dataset.customerAliases) if (!await db.collection('customers').findOne({_id:new ObjectId(a.customerId),isActive:true})) throw Error('Confirmed customer alias is unavailable');
  const datasets = db.collection('financelearningdatasets'), libraries = db.collection('financelearninglibraries'), sources = db.collection('financelearningrows'), groups = db.collection('financelearningpatterns');
  await datasets.createIndex({ownerId:1,bundleHash:1},{unique:true});
  await libraries.createIndex({ownerId:1},{unique:true});
  await sources.createIndex({ownerId:1,datasetId:1,sheet:1,row:1},{unique:true});
  await sources.createIndex({ownerId:1,datasetId:1,patternKey:1,date:1,row:1});
  await sources.createIndex({ownerId:1,datasetId:1,accountId:1,merchant:1,date:1});
  await groups.createIndex({ownerId:1,datasetId:1,key:1},{unique:true});
  await groups.createIndex({ownerId:1,datasetId:1,total:-1,key:1});
  await libraries.updateOne({ownerId},{$setOnInsert:{ownerId,datasetId:null,revision:0}},{upsert:true});
  const library = await libraries.findOne({ownerId});
  let target = await datasets.findOne({ownerId,bundleHash});
  if (String(library.datasetId || '') !== expectedDataset && String(library.datasetId || '') !== String(target?._id || '')) throw Error('Active dataset changed; supply its identifier explicitly to replace it');
  if (!target) {
    const created = await datasets.insertOne({...dataset,ownerId,bundleHash,status:'staging',createdAt:new Date(),updatedAt:new Date()});
    target = {_id:created.insertedId};
  }
  const datasetId = target._id;
  for (const [collection, records, keys] of [[sources,rows,['sheet','row']],[groups,patterns,['key']]]) {
    for (let i=0;i<records.length;i+=200) await collection.bulkWrite(records.slice(i,i+200).map(record => ({updateOne:{filter:{ownerId,datasetId,...Object.fromEntries(keys.map(k=>[k,record[k]]))},update:{$setOnInsert:{...record,ownerId,datasetId}},upsert:true}})),{ordered:true});
    if (await collection.countDocuments({ownerId,datasetId}) !== records.length) throw Error('Staged dataset count mismatch');
  }
  await datasets.updateOne({_id:datasetId,ownerId},{$set:{status:'ready',updatedAt:new Date()}});
  if (String(library.datasetId || '') !== String(datasetId)) {
    const activated = await libraries.updateOne({ownerId,revision:library.revision,datasetId:library.datasetId},{$set:{datasetId,updatedAt:new Date()},$inc:{revision:1}});
    if (!activated.matchedCount) throw Error('Another dataset was activated; prepared data remains inactive');
  }
  return {datasetId:String(datasetId),sourceHash:dataset.sourceHash,...dataset.summary};
}
async function main() {
  const [mode,input,configPath,output] = process.argv.slice(2);
  if (mode === 'prepare' && input && configPath && output) {
    const {prepareWorkbook} = await import('./finance-learning-workbook.mjs');
    const bundle = prepareWorkbook(await fs.readFile(input), JSON.parse(await fs.readFile(configPath,'utf8')));
    await fs.writeFile(output,JSON.stringify(bundle),{flag:'wx'}); console.log(JSON.stringify(bundle.dataset.summary)); return;
  }
  if (mode === 'load' && input) {
    const {default:dotenv} = await import('dotenv'); dotenv.config({quiet:true});
    if (!process.env.MONGO_URI) throw Error('MONGO_URI is required');
    const client = await MongoClient.connect(process.env.MONGO_URI);
    try { console.log(JSON.stringify(await loadLearningBundle(client.db(),JSON.parse(await fs.readFile(input,'utf8')),configPath || ''))); } finally { await client.close(); } return;
  }
  throw Error('Usage: prepare workbook.xlsx private-config.json new-bundle.json | load bundle.json [expected-active-dataset]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error('Learning import failed:',error.message); process.exitCode=1; });
