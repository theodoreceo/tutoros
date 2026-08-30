from pathlib import Path

p = Path('api/bot.js')
s = p.read_text(encoding='utf-8')

# 1) Storage constants.
marker = "const UI_MESSAGE_IDS_KEY = '_ui_message_ids';\n"
insert = marker + "const HW_STORAGE_BUCKET = 'homework-materials';\nconst HW_STORAGE_PREFIX = 'storage:';\n"
if "HW_STORAGE_BUCKET" not in s:
    if marker not in s:
        raise SystemExit('constants marker not found')
    s = s.replace(marker, insert, 1)

# 2) Durable storage + VK re-upload helpers.
helper_marker = "const randomId = () => Math.floor(Math.random() * 2147483647) || 1;\n"
helpers = r'''const storageObjectPath = path => String(path || '')
  .split('/')
  .map(part => encodeURIComponent(part))
  .join('/');

async function ensureHomeworkStorageBucket() {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: SB,
    body: JSON.stringify({
      id: HW_STORAGE_BUCKET,
      name: HW_STORAGE_BUCKET,
      public: false,
      file_size_limit: 20 * 1024 * 1024,
      allowed_mime_types: ['application/pdf'],
    }),
  });
  if (response.ok) return;
  const text = await response.text();
  if ((response.status === 400 || response.status === 409)
      && /already exists|duplicate/i.test(text)) return;
  throw new Error(`storage bucket: ${text || response.status}`);
}

async function uploadHomeworkStorageObject(path, bytes) {
  await ensureHomeworkStorageBucket();
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true',
      },
      body: bytes,
    },
  );
  if (!response.ok) throw new Error(`storage upload: ${await response.text()}`);
}

async function downloadHomeworkStorageObject(path) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    { headers: { 'apikey': SUPABASE_SECRET_KEY, 'Authorization': `Bearer ${SUPABASE_SECRET_KEY}` } },
  );
  if (!response.ok) throw new Error(`storage download: ${await response.text()}`);
  return response.arrayBuffer();
}

const materialPathFromRef = ref => String(ref || '').startsWith(HW_STORAGE_PREFIX)
  ? String(ref).slice(HW_STORAGE_PREFIX.length)
  : null;

const safePdfName = value => {
  const base = String(value || 'homework.pdf')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'homework.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
};

async function resolveVkDocumentInfo(document) {
  if (document?.url) return document;
  const fileId = document?.file_id;
  if (!fileId || !String(fileId).startsWith('doc')) return null;
  const response = await vk('docs.getById', { docs: String(fileId).slice(3) });
  const doc = Array.isArray(response) ? response[0] : response?.items?.[0] || response?.doc || null;
  return doc ? {
    ...document,
    url: doc.url,
    title: doc.title,
    ext: doc.ext,
    size: doc.size,
  } : null;
}

async function persistHomeworkMaterial(document, assignmentId) {
  const info = await resolveVkDocumentInfo(document);
  if (!info?.url) throw new Error('VK не дал ссылку на документ');
  const ext = String(info.ext || '').toLowerCase();
  const title = String(info.title || 'homework.pdf');
  if (ext && ext !== 'pdf' && !title.toLowerCase().endsWith('.pdf')) {
    throw new Error('нужен именно PDF-файл');
  }
  const source = await fetch(info.url);
  if (!source.ok) throw new Error(`VK download: ${source.status}`);
  const bytes = await source.arrayBuffer();
  if (!bytes.byteLength) throw new Error('пустой PDF');
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('PDF больше 20 МБ');
  const filename = safePdfName(title);
  const path = `${assignmentId}/${Date.now()}-${filename}`;
  await uploadHomeworkStorageObject(path, bytes);
  return `${HW_STORAGE_PREFIX}${path}`;
}

async function storedMaterialToVkAttachment(peerId, materialRef) {
  const path = materialPathFromRef(materialRef);
  if (!path) return null;
  const bytes = await downloadHomeworkStorageObject(path);
  const rawName = path.split('/').pop() || 'homework.pdf';
  const filename = safePdfName(rawName.replace(/^\d+-/, ''));
  const server = await vk('docs.getMessagesUploadServer', { peer_id: peerId, type: 'doc' });
  if (!server?.upload_url) throw new Error('VK не выдал upload_url');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  const uploadedResponse = await fetch(server.upload_url, { method: 'POST', body: form });
  const uploaded = await uploadedResponse.json().catch(() => null);
  if (!uploadedResponse.ok || !uploaded?.file) {
    throw new Error(`VK upload: ${uploaded?.error || uploadedResponse.status}`);
  }
  const saved = await vk('docs.save', { file: uploaded.file, title: filename });
  const doc = Array.isArray(saved) ? saved[0] : saved?.doc || saved?.items?.[0] || saved;
  if (doc?.owner_id === undefined || doc?.id === undefined) {
    throw new Error('VK docs.save не вернул документ');
  }
  return `doc${doc.owner_id}_${doc.id}${doc.access_key ? `_${doc.access_key}` : ''}`;
}

async function sendHomeworkMaterial(peerId, materialRef) {
  if (!materialRef) return false;
  const storedPath = materialPathFromRef(materialRef);
  const attachment = storedPath
    ? await storedMaterialToVkAttachment(peerId, materialRef)
    : materialRef;
  if (!attachment) return false;
  await sendAttachment(peerId, attachment);
  return true;
}

'''
if "async function persistHomeworkMaterial" not in s:
    if helper_marker not in s:
        raise SystemExit('helper marker not found')
    s = s.replace(helper_marker, helpers + helper_marker, 1)

# 3) Keep document metadata from VK callback so the original PDF can be downloaded immediately.
old_doc = "    document: document ? { file_id: attachmentRef(document) } : null,\n"
new_doc = "    document: document ? {\n      file_id: attachmentRef(document),\n      url: document.doc?.url || null,\n      title: document.doc?.title || null,\n      ext: document.doc?.ext || null,\n      size: document.doc?.size || null,\n    } : null,\n"
if old_doc in s:
    s = s.replace(old_doc, new_doc, 1)

# 4) Persist actual PDF on creation and allow replacement on existing homework.
old_upload = '''  // Owner uploading PDF for HW creation
  if (owner) {
    const sess = await getSession(tid);
    if (sess.step === 'await_pdf') {
      const newData = { ...sess.data, file_id: fileId };
      await send(chatId, 'файл получен!');
      return requestHomeworkConfig(chatId, tid, newData);
    }
  }
'''
new_upload = '''  // Owner uploading PDF for HW creation or replacing materials on an existing HW.
  if (owner) {
    const sess = await getSession(tid);
    if (sess.step === 'await_pdf') {
      if (fileType !== 'document' || !fileId) {
        return send(chatId, 'пришли PDF-файл документом.');
      }
      try {
        const assignmentId = sess.data?.assignment_id || botId();
        const durableRef = await persistHomeworkMaterial(msg.document, assignmentId);
        const newData = { ...sess.data, assignment_id: assignmentId, file_id: durableRef };
        await send(chatId, '✅ PDF сохранён в постоянное хранилище.');
        return requestHomeworkConfig(chatId, tid, newData);
      } catch (error) {
        console.error('Homework material persist failed:', error?.message || error);
        return send(chatId, `❌ не удалось сохранить PDF: ${error.message}\n\nотправь файл ещё раз.`);
      }
    }
    if (String(sess.step || '').startsWith('replace_hw_material:')) {
      const hwId = String(sess.step).slice('replace_hw_material:'.length);
      if (fileType !== 'document' || !fileId) {
        return send(chatId, 'пришли новый PDF-файл документом.');
      }
      try {
        const durableRef = await persistHomeworkMaterial(msg.document, hwId);
        await sbPatch('homework_assignments', `id=eq.${encodeURIComponent(hwId)}`, { file_id: durableRef });
        await setSession(tid, { step: 'owner' });
        return send(chatId, '✅ материалы ДЗ заменены и сохранены в постоянное хранилище.',
          kbd([[{ text: '← назад к ДЗ', callback_data: `dz:${hwId}` }]]));
      } catch (error) {
        console.error('Homework material replacement failed:', error?.message || error);
        return send(chatId, `❌ не удалось сохранить PDF: ${error.message}\n\nотправь файл ещё раз.`);
      }
    }
  }
'''
if old_upload not in s:
    raise SystemExit('owner upload block not found')
s = s.replace(old_upload, new_upload, 1)

# 5) All homework material delivery goes through durable helper; legacy VK ids still work.
s = s.replace("await sendAttachment(chatId, assignment.file_id);", "await sendHomeworkMaterial(chatId, assignment.file_id);")

# 6) Add replace/upload button to active and archived owner HW cards.
materials_row = "        [{ text: '📎 материалы', callback_data: `dz_materials:${hwId}` }],\n"
replacement_row = materials_row + "        [{ text: a.file_id ? '♻️ заменить материалы' : '📤 загрузить материалы', callback_data: `dz_material_replace:${hwId}` }],\n"
count = s.count(materials_row)
if count == 2 and "dz_material_replace:${hwId}" not in s:
    s = s.replace(materials_row, replacement_row)
elif "dz_material_replace:${hwId}" not in s:
    raise SystemExit(f'expected 2 materials button rows, found {count}')

# 7) Callback to start replacement flow.
callback_marker = "  if (data.startsWith('dz_materials:') && owner) {\n    return showDzMaterials(chatId, data.slice('dz_materials:'.length));\n  }\n"
callback_insert = "  if (data.startsWith('dz_material_replace:') && owner) {\n    const hwId = data.slice('dz_material_replace:'.length);\n    const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(hwId)}&select=id,topic`);\n    if (!assignment) return send(chatId, 'ДЗ не найдено.');\n    await setSession(tid, { step: `replace_hw_material:${hwId}`, data: { hwId } });\n    return send(chatId, `пришли новый PDF для ДЗ «${html(assignment.topic || '—')}».\\n\\nОн будет сохранён независимо от VK.`,\n      kbd([[{ text: '❌ отменить', callback_data: `dz:${hwId}` }]]));\n  }\n" + callback_marker
if "data.startsWith('dz_material_replace:')" not in s:
    if callback_marker not in s:
        raise SystemExit('materials callback marker not found')
    s = s.replace(callback_marker, callback_insert, 1)

p.write_text(s, encoding='utf-8')
