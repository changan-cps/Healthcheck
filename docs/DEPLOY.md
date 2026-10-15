# ติดตั้งและ Deploy (Google Apps Script)

## สิ่งที่ต้องมี

- บัญชี Google ที่จะเป็น**เจ้าของระบบ** แนะนำให้ใช้บัญชีกลางของหน่วยงาน ไม่ใช่บัญชีส่วนตัว เพราะฐานข้อมูลและหลักฐานจะอยู่ใน Drive ของบัญชีนี้
- Node.js 18 ขึ้นไป (ใช้ build และ push)
- API Key ของ Gemini ([aistudio.google.com](https://aistudio.google.com)) ไม่ใส่ก็ได้ ระบบส่วนอื่นยังใช้งานได้ และจะแสดงสถานะ "ยังไม่ได้เชื่อมต่อ AI"

## 1. สร้างโปรเจกต์ Apps Script

1. ไปที่ [script.google.com](https://script.google.com) → New project แล้วตั้งชื่อ `CPS AI Audit`
2. Project Settings → คัดลอก **Script ID**
3. เปิด Apps Script API ที่ [script.google.com/home/usersettings](https://script.google.com/home/usersettings)

## 2. Push โค้ด

```bash
git clone https://github.com/changan-cps/healthcheck.git
cd healthcheck
cp .clasp.json.example .clasp.json     # แก้ scriptId เป็นค่าจากขั้นที่ 1
npx @google/clasp login                # login ด้วยบัญชีเจ้าของระบบ
npm run push                           # build → dist/ → clasp push
```

## 3. ตั้งค่าครั้งแรก

1. ใน Apps Script ไปที่ Project Settings → Script Properties → Add property
   - `ADMIN_INITIAL_PASSWORD` = รหัสชั่วคราว ยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข
2. เปิดไฟล์ `Setup.gs` เลือกฟังก์ชัน `setup` แล้วกด Run และอนุญาตสิทธิ์ (Sheets, Drive, External request) ระบบจะ:
   - สร้าง Google Sheet ฐานข้อมูล **(ห้ามแชร์)** และโฟลเดอร์หลักฐาน **(ส่วนตัว)**
   - สร้างตาราง ชุดมาตรฐาน และ Workshop BS/PS/GA/PT/VI/KD
   - สร้างผู้ใช้ `admin` แล้วลบ `ADMIN_INITIAL_PASSWORD` ทิ้ง ระบบจะบังคับให้เปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งแรก

## 4. Deploy เป็น Web App

Deploy → New deployment → ประเภท **Web app**
- Execute as: **Me** (บัญชีเจ้าของระบบ) — ผู้ใช้จะไม่เข้าถึง Sheet หรือ Drive โดยตรง
- Who has access: **Anyone** — ผู้ใช้ไม่ต้องมีบัญชี Google เพราะระบบมี login ของตัวเอง ถ้าทุกคนมี Google Workspace ของบริษัท ให้เลือก "Anyone within <domain>" แทนได้

URL ที่ได้เป็น HTTPS ซึ่งกล้องและไมโครโฟนต้องใช้

## 5. หลังติดตั้ง (ทำผ่านหน้าเว็บด้วย admin)

1. **ตั้งค่า → การเชื่อมต่อ AI:** ใส่ API Key แล้วกด "ทดสอบการเชื่อมต่อ"
2. **ตั้งค่า → Workshop / Group / Team:** เพิ่ม Group และ Team จริง
3. **ตั้งค่า → ผู้ใช้และสิทธิ์:** สร้างผู้ตรวจ เจ้าของหน่วยงาน และผู้ดู พร้อมกำหนดขอบเขต Workshop
4. **มาตรฐาน → นำเข้ามาตรฐานจาก Excel:**
   1. นำเข้าไฟล์ 002 (Health Check) แล้วสร้างฉบับร่าง Team และ Group
   2. นำเข้าไฟล์ 001 (KUP) แล้วเลือกชีตที่ใช้งาน
   3. ในแต่ละฉบับร่าง:
      - ตัดสินจุดที่ไฟล์ไม่ได้ระบุ (คะแนนต่ำสุด, วิธีนับ Red Line, สูตร KUP)
      - กำหนดคะแนนเต็มของข้อที่ไม่ระบุ
      - ยืนยันจำนวนตัวอย่าง
      - ตรวจทานป้ายทุกรายการ
      - ปรับเส้นทางการออดิท แล้วกด **ประกาศใช้**

## อัปเดตเวอร์ชัน

```bash
git pull
npm test
npm run push
```

จากนั้นรัน `migrate()` ใน Apps Script หนึ่งครั้ง ฟังก์ชันนี้ปลอดภัยถ้ารันซ้ำ เพราะจะเพิ่มตารางหรือคอลัมน์ใหม่โดยไม่ลบข้อมูลเดิม
ไปที่ Deploy → Manage deployments → แก้ deployment เดิม → Version: New version เพื่อให้ URL เดิมใช้โค้ดใหม่

## สำรองข้อมูล

- **ฐานข้อมูล:** ใช้ File → Make a copy ของ Google Sheet ฐานข้อมูล หรือตั้ง Google Takeout
- **หลักฐาน:** อยู่ในโฟลเดอร์ "CPS AI Audit — Evidence (private)" ใน Drive ของบัญชีเจ้าของระบบ

## ความปลอดภัย

- API Key เก็บใน Script Properties ระบบไม่ส่งคีย์ไปที่หน้าเว็บ ไม่เขียนลงฐานข้อมูล และไม่บันทึกใน log
- ระบบตรวจสิทธิ์ที่ฝั่งเซิร์ฟเวอร์ทุก API รวมถึงการเปิดไฟล์หลักฐาน ไฟล์ใน Drive ไม่ถูกแชร์ออกไป
- รหัสผ่านเก็บแบบ salted HMAC-SHA256 วนซ้ำ 2,000 รอบ ถ้าใส่ผิด 5 ครั้งจะล็อกบัญชี 15 นาที และ session หมดอายุใน 12 ชั่วโมง
- repository `changan-cps/healthcheck` เป็น **Public** จึงห้าม commit ไฟล์มาตรฐาน หลักฐาน หรือ `.clasp.json` (`.gitignore` กันไว้แล้ว) และควรพิจารณาเปลี่ยน repo เป็น Private
