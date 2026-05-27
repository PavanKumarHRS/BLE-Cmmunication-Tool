// -------------------- LOGGING --------------------
const logEl = document.getElementById('log');
function log(msg){
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `\n[${t}] ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(txt, ok){
  const el = document.getElementById('connStatus');
  el.textContent = txt;
  el.className = ok ? "green" : "red";
}

// -------------------- HEX UTILITIES --------------------
function textToHex(str){
  const utf8 = new TextEncoder().encode(str);
  return Array.from(utf8, b => b.toString(16).padStart(2,"0")).join("");
}

function hexToBytes(hex){
  const clean = hex.replace(/[^0-9a-fA-F]/g,"");
  if(clean.length % 2 !== 0) throw new Error("Invalid hex");
  const arr = new Uint8Array(clean.length/2);
  for(let i=0;i<clean.length;i+=2) arr[i/2] = parseInt(clean.slice(i,i+2),16);
  return arr;
}

// -------------------- BLE STATE --------------------
let device=null,server=null,writeCharacteristic=null,notifyCharacteristic=null;
let abortUpload=false;

// -------------------- BLE BUTTON HANDLERS --------------------
document.getElementById("scanBtn").onclick = async ()=>{
  try{
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        "battery_service","device_information",
        "generic_access","generic_attribute",
        "6e400001-b5a3-f393-e0a9-e50e24dcca9e"  // Nordic UART
      ]
    });

    document.getElementById("deviceName").textContent = device.name || "Unknown";
    document.getElementById("deviceId").textContent = device.id;
    device.addEventListener("gattserverdisconnected",()=>setStatus("Disconnected",false));
    log("Device selected: " + (device.name || "Unknown"));
  }
  catch(e){
    log("Scan failed: " + e);
  }
};

document.getElementById("connectBtn").onclick = async ()=>{
  if(!device) return alert("Scan first");

  try{
    setStatus("Connecting...",false);
    server = await device.gatt.connect();
    setStatus("Connected",true);
    log("Connected");
    await listServices();
  }
  catch(e){
    log("Connect error: "+e);
  }
};

document.getElementById("disconnectBtn").onclick = ()=>{
  if(device?.gatt.connected) device.gatt.disconnect();
};

// -------------------- SERVICE LIST --------------------
async function listServices(){
  const out = document.getElementById("svcList");
  out.textContent = "";

  try{
    const svcs = await server.getPrimaryServices();
    for(const svc of svcs){
      out.textContent += `Service: ${svc.uuid}\n`;
      const chars = await svc.getCharacteristics();
      for(const ch of chars){
        out.textContent += `  Char: ${ch.uuid} props: ${JSON.stringify(ch.properties)}\n`;
      }
    }
    log("Services listed.");
  }
  catch(e){
    log("List error: "+e);
  }
}

document.getElementById("listServicesBtn").onclick = ()=>{
  if(!server) return alert("Connect first");
  listServices();
};

// -------------------- ENSURE WRITE CHARACTERISTIC --------------------
async function ensureWriteCharacteristic(){
  if(writeCharacteristic) return;

  const userUUID = document.getElementById("writeChar").value.trim();

  if(userUUID){
    const svcs = await server.getPrimaryServices();
    for(const s of svcs){
      try{
        writeCharacteristic = await s.getCharacteristic(userUUID);
        break;
      }catch{}
    }
  }

  if(!writeCharacteristic){
    const nus = await server.getPrimaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    writeCharacteristic = await nus.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    notifyCharacteristic = await nus.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
  }

  if(notifyCharacteristic){
    await notifyCharacteristic.startNotifications();
    notifyCharacteristic.addEventListener("characteristicvaluechanged",(e)=>{
      const txt = new TextDecoder().decode(e.target.value);
      log("Notify: " + txt);
    });
  }

  log("Write characteristic ready.");
}

// -------------------- SEND TEXT --------------------
document.getElementById("sendTextBtn").onclick = async ()=>{
  const txt = document.getElementById("sendText").value;
  await ensureWriteCharacteristic();
  await writeCharacteristic.writeValue(new TextEncoder().encode(txt));
  log("Sent text: " + txt);
};

// -------------------- FILE UPLOAD (TXT or HEX) --------------------
document.getElementById("fileInput").onchange = async (ev)=>{
  const f = ev.target.files[0];
  if(!f) return;

  const text = await f.text();
  let cleaned = "";

  if(f.name.toLowerCase().endsWith(".txt")){
    cleaned = textToHex(text);
    log("TXT converted to HEX (" + cleaned.length/2 + " bytes)");
  } else {
    cleaned = text.replace(/[^0-9a-fA-F]/g,"");
    log("HEX loaded (" + cleaned.length/2 + " bytes)");
  }

  document.getElementById("hexInput").value = cleaned;
  document.getElementById("bytesTotal").textContent = cleaned.length/2;
};

// -------------------- SEND HEX --------------------
document.getElementById("sendHexBtn").onclick = async ()=>{
  const hex = document.getElementById("hexInput").value.trim();
  if(!hex) return alert("Paste hex first");

  let bytes;

  try{
    bytes = hexToBytes(hex);
  }catch(e){
    return alert("Invalid HEX: " + e.message);
  }

  if(!confirm("Upload " + bytes.length + " bytes?")) return;

  abortUpload = false;
  await ensureWriteCharacteristic();

  try{
    await upload(bytes, 244);
  }
  catch(e){
    log("Upload error: " + e);
  }
};

document.getElementById("abortBtn").onclick = ()=>{
  abortUpload = true;
  log("Abort requested");
};

// -------------------- UPLOAD CHUNKS --------------------
async function upload(data,chunk){
  const total = data.length;
  let sent = 0;
  const start = performance.now();

  document.getElementById("bytesTotal").textContent = total;

  for(let i=0; i<total; i+=chunk){
    if(abortUpload){
      log("Upload aborted.");
      throw "Aborted";
    }

    const part = data.slice(i, Math.min(i+chunk,total));
    await writeCharacteristic.writeValue(part);

    sent = i + part.length;

    const pct = Math.round((sent/total)*100);
    document.getElementById("bytesSent").textContent = sent;
    document.getElementById("progressBar").style.width = pct + "%";

    const sec = (performance.now() - start) / 1000;
    document.getElementById("speed").textContent = Math.round(sent/sec);

    await new Promise(r => setTimeout(r, 5));
  }

  log("Upload complete.");
}
