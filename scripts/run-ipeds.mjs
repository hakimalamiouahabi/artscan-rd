import {spawnSync} from 'node:child_process';

const candidates=[
  ...(process.env.PYTHON?[{cmd:process.env.PYTHON,prefix:[]}]:[]),
  {cmd:'python3',prefix:[]},
  {cmd:'python',prefix:[]},
  {cmd:'py',prefix:['-3']}
];

let selected=null;
for(const c of candidates){
  const probe=spawnSync(c.cmd,[...c.prefix,'--version'],{encoding:'utf8'});
  if(probe.status===0){selected=c;break}
}
if(!selected)throw new Error('Python 3 executable not found (tried PYTHON, python3, python, py -3)');

const run=spawnSync(selected.cmd,[...selected.prefix,'scripts/import_ipeds_public_research.py'],{stdio:'inherit'});
if(run.error)throw run.error;
if(run.status!==0)process.exit(run.status??1);
