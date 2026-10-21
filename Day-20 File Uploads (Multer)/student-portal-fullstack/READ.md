Folder name: `job-portal-fullstack`

**Concepts jo is mein use hongi:**
- **Day 11:** validation
- **Day 12:** `.env`
- **Day 13:** `AppError` aur `catchAsync`
- **Day 14:** search, filter, sort, pagination
- **Day 15:** relationships aur `populate`
- **Day 16-17:** bcrypt aur JWT
- **Day 18:** roles aur `restrictTo`
- **Day 19:** helmet, rate limit, injection se bachao
- **Day 20:** Multer file upload (resume PDF)

---

## 1️⃣ System Kya Hai?

Ye Rozee.pk jaisa chhota job portal hai. Teen tarah ke log use karte hain:

| Role | Kaun hai | Kya kar sakta hai |
|---|---|---|
| **jobseeker** | Naukri dhoondne wala | Jobs search kare, resume (PDF) ke saath apply kare, apni applications dekhe, apni application withdraw kare |
| **employer** | Company wala | Job post kare, **sirf apni** jobs edit/close kare, apni jobs ke applicants dekhe, applicant ko shortlist/reject/hire kare, resume download kare |
| **admin** | Portal ka manager | Stats dekhe, users ki list dekhe, kisi ki bhi job delete kare |

**Real-life flow:**
Employer signup karke job post karta hai. Jobseeker jobs search karta hai, ek job par cover letter aur PDF resume ke saath apply karta hai. Employer apni job ke applicants ki list dekhta hai, resume download karke parhta hai, aur status badalta hai (Shortlisted, Hired ya Rejected). Jobseeker apne dashboard par apni application ka status dekhta hai.

---

## 2️⃣ Folder Structure

```
job-portal-fullstack/
├── config/        → db.js
├── models/        → User, Job, Application
├── middleware/    → protect, restrictTo, upload, handleValidation
├── routes/        → authRoutes, jobRoutes, applicationRoutes, adminRoutes
├── utils/         → AppError, catchAsync
├── public/        → frontend (html, css, js)
├── uploads/       → resumes (khud banao, khali, .gitignore mein)
├── .env
├── .gitignore
└── server.js
```

---

## 3️⃣ `.env` Mein Kya Kya Hoga

| Variable | Kaam |
|---|---|
| `PORT` | server ka port (jaise 9100) |
| `MONGO_URI` | database connection |
| `JWT_SECRET` | token sign karne ki key |
| `JWT_EXPIRES_IN` | token kitni der valid (jaise 1d) |
| `MAX_RESUME_SIZE_MB` | resume ki size limit (3 rakho) |
| `MAX_APPLICATIONS_PER_DAY` | ek jobseeker ek din mein kitni jobs par apply kar sakta hai (5 rakho) |

`.gitignore` mein `node_modules`, `.env` aur `uploads/` zaroor hon.

---

## 4️⃣ Teen Models

### Model 1: User
- `name`: required
- `email`: required, **unique**
- `password`: required, **hashed**
- `role`: `jobseeker`, `employer` ya `admin`. Default `jobseeker`

> **Role ka rule (zara dhyan se):** Pehle humne kaha tha "role client se mat lo." Yahan thori nuance hai. Signup par user **jobseeker ya employer** chun sakta hai, kyunke dono safe roles hain. Lekin **`admin` kabhi signup se nahi ban sakta.** Validation mein role sirf in dono values mein se ek hona chahiye, warna 400. Admin `mongosh` se manually banao.

### Model 2: Job
- `title`: required
- `description`: required
- `company`: required
- `location`: jaise "Lahore", "Remote"
- `jobType`: `Full-time`, `Part-time`, `Internship`
- `salary`: number
- `deadline`: last date to apply
- `status`: `Open` ya `Closed`. Default `Open`
- `postedBy`: **reference** to User (kis employer ne post ki) → Day 15
- `createdAt`: default abhi ka time

### Model 3: Application
- `job`: **reference** to Job
- `applicant`: **reference** to User
- `coverLetter`: text, max 500 characters
- `resume`: file ka **naam** (path nahi)
- `status`: `Applied`, `Shortlisted`, `Rejected`, `Hired`. Default `Applied`
- `appliedAt`: default abhi ka time

Application mein **do references** hain (job aur applicant). Day 15 ki asli practice yahin hogi.

---

## 5️⃣ Routes: Kaun Kya Kar Sakta Hai

### 🔐 Auth (`/auth`)
| Route | Kaun | Kaam |
|---|---|---|
| `POST /auth/signup` | Koi bhi | Account banao (role: jobseeker ya employer) |
| `POST /auth/login` | Koi bhi | Login, token lo |

### 💼 Jobs (`/jobs`)
| Route | Kaun | Kaam |
|---|---|---|
| `GET /jobs` | **Public** (token nahi chahiye) | Search/filter/sort/paginate |
| `GET /jobs/:id` | **Public** | Ek job ki detail |
| `GET /jobs/my` | Sirf employer | Apni posted jobs |
| `POST /jobs` | Sirf employer | Nayi job post karo |
| `PUT /jobs/:id` | Sirf employer (**owner**) | Job edit karo |
| `PUT /jobs/:id/close` | Sirf employer (**owner**) | Job band karo |
| `DELETE /jobs/:id` | Employer (**owner**) ya admin | Job delete karo |

> `/jobs/my` ko `/jobs/:id` se **upar** likhna, warna Express "my" ko ID samajh lega.

### 📄 Applications (`/applications`)
| Route | Kaun | Kaam |
|---|---|---|
| `POST /applications` | Sirf jobseeker | Apply karo (**form-data**, PDF ke saath) |
| `GET /applications/my` | Sirf jobseeker | Apni applications |
| `GET /applications/job/:jobId` | Sirf employer (**job ka owner**) | Us job ke applicants |
| `PUT /applications/:id/status` | Sirf employer (**job ka owner**) | Status badlo |
| `GET /applications/:id/resume` | Applicant, job ka owner, ya admin | Resume download |
| `DELETE /applications/:id` | Sirf jobseeker (**apni**) | Application withdraw karo |

### 🛡️ Admin (`/admin`)
| Route | Kaun | Kaam |
|---|---|---|
| `GET /admin/stats` | Sirf admin | Portal ke numbers |
| `GET /admin/users` | Sirf admin | Users ki list (paginated, `?role=` filter) |

---

## 6️⃣ Business Rules (Sabse Zyada Dhyan Se Parho)

### Rule A: Jobs Ki Listing (Day 14)
`GET /jobs` mein ye sab **ek sath** kaam kare:
- **Pagination:** `page`, `limit` (default 5)
- **Sorting:** `sortBy`, `order` (default: sabse nayi pehle)
- **Search:** `search` se `title` mein case-insensitive match
- **Filters:** `location`, `jobType`, aur `minSalary`/`maxSalary` ki range
- **Default sirf `Open` jobs dikhao.** Closed jobs listing mein nahi aani chahiye
- Har job mein `postedBy` **populate** ho (sirf `name`)
- Response mein `page`, `totalPages`, `totalJobs`, `data`

### Rule B: Ownership (Sabse Important Security Rule)
Employer A, Employer B ki job edit, close ya delete nahi kar sakta, chahe dono ke paas valid employer token ho.
- Har aise route par pehle job dhoondo, phir `job.postedBy` ka token ki `id` se mukabla karo
- Match na ho to **403**
- Ye wahi pattern hai jo Notes Vault mein tha

### Rule C: Apply Karte Waqt (is order mein checks)
Jobseeker `job` (ID), `coverLetter` aur `resume` (PDF) bhejta hai. Server ye checks karega:

1. Resume file maujood hai, warna 400
2. Job exist karti hai, warna 404
3. Job ka `status` `Open` hai, warna 409
4. **Deadline guzar to nahi gayi**, warna 400
5. Is jobseeker ne is job par **pehle apply to nahi kiya** (duplicate), warna 409
6. Jobseeker ne **aaj** `MAX_APPLICATIONS_PER_DAY` (`.env` se) se zyada applications to nahi di, warna 429 ya 400

> **Applicant ki ID token se aayegi** (`req.user.id`), `req.body` se kabhi nahi.

> **Dhyan:** Agar koi check fail ho jaye (maslan job closed ho), to upload ho chuki resume file disk par pari reh jayegi. Ye ek real masla hai. Kam se kam sochna ke isay kaise handle karoge (hint: `fs.unlink`). Ye bonus hai, lekin sochna zaroor.

### Rule D: Resume Public Nahi Honi Chahiye 🔥
Pichle project mein humne `uploads/` ko `express.static` se public kiya tha. **Yahan ye ghalti nahi karni.** Resume mein naam, phone, address hota hai. Agar `uploads/` public ho aur koi filename guess kar le, to kisi ka bhi resume khul jayega.

Is liye:
- `uploads/` ko `express.static` se **kabhi expose mat karo**
- Resume sirf `GET /applications/:id/resume` route se milegi, jis par pehle `protect` aur phir **ownership check** ho
- Sirf teen log download kar sakte hain: applicant khud, us job ka employer (owner), aur admin. Baaki sab ko **403**
- Download ke liye `res.download()` ya `res.sendFile()` dekho

### Rule E: Status Ka Flow
```
Applied → Shortlisted → Hired
Applied → Rejected
Shortlisted → Rejected
```
- `Hired` aur `Rejected` **final** hain, ye dobara nahi badal sakte (400)
- `Applied` se seedha `Hired` nahi ho sakta, pehle `Shortlisted` zaroori hai
- Sirf us job ka **owner employer** status badal sakta hai. Application dhoondo, uski `job` populate karo, phir `postedBy` check karo

### Rule F: Withdraw
Jobseeker sirf **apni** application withdraw kar sakta hai, aur sirf tab jab status `Applied` ho. Shortlisted ya Hired application withdraw nahi ho sakti.

### Rule G: Job Delete Par Cascade
Job delete hone par us ki **saari applications bhi delete** ho jayen (`deleteMany`), warna orphan records bach jayenge jin ki `job` ID ab exist hi nahi karti.

### Rule H: Admin Stats
`GET /admin/stats` mein ye numbers: total users (role ke hisab se), total jobs (open aur closed), total applications (har status ke hisab se).

---

## 7️⃣ Security Requirements (Day 19 aur 20)

| Cheez | Kahan |
|---|---|
| **helmet** | Poori app, sabse upar |
| **General rate limiter** | 15 min mein 100 requests |
| **Login limiter** | Sirf `/auth/login`, 10 min mein 5 |
| **Signup limiter** | Sirf `/auth/signup`, 1 ghante mein 10 (fake accounts ka spam rokne ke liye) |
| **Body limit** | `express.json({ limit: '10kb' })` |
| **Type validation** | Har POST/PUT par `isString()`, har `:id` par `isMongoId()` |
| **Upload limits** | Sirf **PDF** (`application/pdf`), size `.env` se, naam khud banao |
| **Resume access** | Rule D |

**Multer errors:** Global error handler mein `LIMIT_FILE_SIZE` alag handle karo. Saath hi "sirf PDF allowed" wali error ko bhi JSON mein wapas bhejo.

**Extra:** Duplicate key error (MongoDB code `11000`) ko global handler mein 409 mein badlo. Isse duplicate email par ajeeb 500 nahi aayega.

⚠️ **Yaad rakho:** `mimetype` client ka batayi hui value hai, is liye ye filter sirf learning level par kaafi hai.

---

## 8️⃣ Frontend (Ye Bhi Aap Likhoge)

Pichli baar frontend ka code diya tha, is baar sirf ye batata hoon ke har page kya kare. Frontend `public/` mein ho aur Express se serve ho (same port, to CORS ki zaroorat nahi). Hamesha `http://localhost:PORT` se kholo, file double-click mat karo.

### Page 1: `index.html` (Register + Login)
- Register form: name, email, password, aur **role ka dropdown** (jobseeker/employer)
- Login form
- Login ke baad token `localStorage` mein save karo aur **role ke hisab se redirect** karo: jobseeker → `jobs.html`, employer → `employer.html`, admin → `admin.html`
- Validation aur API ki errors form ke upar dikhao

### Page 2: `jobs.html` (Jobseeker)
- Jobs ki list **cards** mein
- Search box, location aur jobType ke filters, sort dropdown
- **Prev/Next pagination buttons** jo `totalPages` ke hisab se disable ho jayen
- Har job par **Apply** button. Click par cover letter ka box aur **PDF file input** khule
- Apply `FormData` se jaye (Day 20 wala sabaq: `Content-Type` khud mat likhna)
- Neeche ya alag section mein **"My Applications"** jahan har application ka status dikhe

### Page 3: `employer.html` (Employer)
- Naya job post karne ka form
- "My Jobs" ki list, har job par Close aur Delete buttons
- Job par click karo to uske **applicants** ki list dikhe (naam, email, cover letter, status)
- Har applicant par **Shortlist / Reject / Hire** buttons (sirf wahi buttons dikhao jo flow ke hisab se mumkin hon)
- **Download Resume** button. Isay sochna parega:

> **Tricky hissa:** Download ke liye plain `<a href="/applications/ID/resume">` kaam **nahi karega**, kyunke browser link kholte waqt `Authorization` header nahi bhejta, to `protect` 401 de dega. Sahi tareeka: `fetch()` se token ke saath resume mangwao, response ko **blob** mein badlo, `URL.createObjectURL(blob)` se temporary link banao, aur us par click karwao. In teen cheezon (`blob`, `createObjectURL`, `<a download>`) ko khud search karke samjho.

### Page 4: `admin.html` (Bonus)
- Stats ke numbers (cards mein)
- Users ki table, role filter aur pagination ke saath

### Frontend Ki Zaroori Baatein
- Har protected page ki shuruaat mein check karo ke token hai, warna login par bhej do
- Agar API **401** de (token expire), token delete karo aur login par bhej do
- **Role guard:** jobseeker agar `employer.html` kholne ki koshish kare to wapas bhej do. Ye sirf **user ki suhulat** hai, asli security backend ka `restrictTo` hai, kyunke frontend ko koi bhi bypass kar sakta hai
- Scripts alag `.js` files mein ho, inline nahi (helmet ki CSP inline scripts block karti hai)

---

## 9️⃣ API Ka Contract (Frontend aur Backend Isi Par Jurenge)

| Request | Success | Failure |
|---|---|---|
| `POST /auth/login` | `200` `{ success, token, role, name }` | `401` `{ success: false, error }` |
| `POST /auth/signup` | `201` `{ success: true }` | validation: `{ success: false, errors: [{ msg }] }`, baaki: `{ success: false, error }` |
| `GET /jobs` | `200` `{ success, page, totalPages, totalJobs, data }` | |
| `POST /applications` | `201` `{ success, data }` | `400/404/409/429` `{ success: false, error }` |
| `GET /applications/job/:id` | `200` `{ success, data }` (applicant populated) | `403/404` |

**Har error response JSON ho** (rate limiter ka message bhi), warna frontend ka `res.json()` toot jayega.

---

## 🔟 Build Order (Isi Sequence Mein)

1. **Setup:** folders, `.env`, `.gitignore`, `db.js`, `AppError`, `catchAsync`, npm install
2. **User model, signup, login** (bcrypt + JWT, role validation). Postman se test karo
3. **`protect` aur `restrictTo`.** Ek chhota test route banao
4. **Job model + routes** (pehle `POST`, phir listing wali Rule A, phir ownership wale routes)
5. **Frontend Page 1 aur Page 2 (sirf jobs listing).** Browser mein dekho ke search/pagination chal rahi hai
6. **Application model + `upload.js` + apply route** (Rule C ek ek check karke)
7. **`my`, `job/:jobId`, status, withdraw routes**
8. **Resume download route** (Rule D)
9. **Frontend:** apply form, employer page, resume download wala blob trick
10. **Admin routes + stats**
11. **Security layer** (limiters, helmet, body limit) aur error handler
12. **Poori testing**

```
npm install express mongoose bcrypt jsonwebtoken dotenv helmet express-rate-limit express-validator multer
```

---

## ✅ Testing Checklist

**Auth aur Roles:**
- [ ] Signup mein `role: "admin"` bhejo, **400** aaye
- [ ] 1 admin (manually), 2 employers, 2 jobseekers banao
- [ ] Jobseeker token se `POST /jobs` → **403**
- [ ] Employer token se `POST /applications` → **403**
- [ ] Bina token `GET /jobs` → **200** (ye public hai)

**Jobs:**
- [ ] `GET /jobs?search=dev&location=Lahore&jobType=Full-time&sortBy=salary&order=desc&page=1&limit=3` sab ek sath chale
- [ ] Closed job listing mein na aaye
- [ ] Employer B, Employer A ki job edit/close/delete kare → **403**
- [ ] Admin kisi ki bhi job delete kar sake
- [ ] Job delete ho to uski applications bhi chali jayen

**Applications:**
- [ ] PDF ke saath apply → 201
- [ ] Wahi job dobara apply → **409**
- [ ] `.png` ya `.docx` upload → reject
- [ ] 3 MB se bari PDF → "too large"
- [ ] Bina file apply → 400
- [ ] Closed job par apply → 409
- [ ] Deadline guzri job par apply → 400
- [ ] 6th application ek din mein → rok di jaye
- [ ] Jobseeker A, Jobseeker B ki application withdraw kare → **403**
- [ ] Shortlisted application withdraw → 400

**Status aur Resume:**
- [ ] `Applied → Hired` seedha → 400
- [ ] `Hired` ko dobara badlo → 400
- [ ] Doosre employer ka status badalna → **403**
- [ ] Resume: applicant, owner employer aur admin download kar sakein
- [ ] Resume: koi doosra jobseeker ya doosra employer → **403**
- [ ] Browser mein `http://localhost:PORT/uploads/koi-filename.pdf` kholo → **404** aana chahiye (static expose nahi hai)

**Security:**
- [ ] Login body mein `{ "$ne": null }` → **400**
- [ ] Login 6 baar galat → **429**
- [ ] `X-Powered-By` header na ho
- [ ] Token delete karke protected page kholo, login par bhej de

---

## 🎯 Bonus Challenges

1. **Purani file cleanup:** jab application withdraw ya job delete ho, resume files bhi `fs.unlink` se disk se hata do
2. **Compound unique index:** `Application` mein `job` aur `applicant` ka combined unique index lagao, taake duplicate application database level par bhi rok jaye
3. **`GET /jobs/my`** mein har job ke saath **applicants ki ginti** dikhao (`countDocuments` ya aggregation)
4. **Employer ke liye `?status=` filter** applicants ki list par

---

✅ Khud Se Poochho (Project Ke Baad)

1. Resume ke liye `express.static` kyun use nahi kiya?
2. Resume download mein `<a href>` kaam kyun nahi karta?
3. Ownership check ke baghair employer B kya kar sakta tha?
4. Frontend ka role guard asli security kyun nahi hai?
5. Job delete par applications bhi kyun delete karni parti hain?
6. `applicant` ko `req.body` se kyun nahi liya?

