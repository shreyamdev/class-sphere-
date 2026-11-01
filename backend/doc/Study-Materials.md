# Study Materials & Resources APIs

Base URL: `http://localhost:5000`. All endpoints require `Authorization: Bearer <ACCESS_TOKEN>`.

PDF files are stored in Cloudinary as authenticated raw assets. The API checks classroom access before listing/downloading. Upload maximum: 10 MB, one PDF per request.

## 1. Upload PDF

**POST** `/api/classrooms/CLASSROOM_ID/materials` — classroom owner teacher only.

Use `multipart/form-data`, not JSON:

| Form field | Type | Required | Notes |
|---|---|---|---|
| `file` | File | Yes | PDF, max 10 MB |
| `title` | Text | Yes | 3–150 characters |
| `description` | Text | No | max 2000 characters |

Example fields in Postman: `file` → choose a PDF file; `title` → `Unit 2 Notes`; `description` → `Trees and graphs lecture notes`.

Success `201`:
```json
{
  "success": true,
  "message": "Study material uploaded successfully.",
  "material": {
    "_id": "671234567890abcdef123456",
    "title": "Unit 2 Notes",
    "description": "Trees and graphs lecture notes",
    "classroom": "671234567890abcdef123457",
    "uploadedBy": "671234567890abcdef123458",
    "cloudinaryPublicId": "classsphere/study-materials/example.pdf",
    "originalName": "unit-2.pdf",
    "fileSize": 245760,
    "mimeType": "application/pdf",
    "createdAt": "2026-10-22T10:00:00.000Z",
    "updatedAt": "2026-10-22T10:00:00.000Z"
  }
}
```
The public ID above is illustrative. Do not expose Cloudinary credentials. In the upload response, `cloudinaryPublicId` currently exists in the material object; list responses intentionally omit it.

## 2. List classroom materials

**GET** `/api/classrooms/CLASSROOM_ID/materials` — owning teacher or enrolled student.

Response `200`:
```json
{
  "success": true,
  "count": 1,
  "materials": [
    {
      "_id": "671234567890abcdef123456",
      "title": "Unit 2 Notes",
      "description": "Trees and graphs lecture notes",
      "classroom": "671234567890abcdef123457",
      "uploadedBy": { "_id": "671234567890abcdef123458", "name": "Teacher Name", "email": "teacher@example.com" },
      "originalName": "unit-2.pdf",
      "fileSize": 245760,
      "mimeType": "application/pdf",
      "downloadUrl": "/api/materials/671234567890abcdef123456/download",
      "createdAt": "2026-10-22T10:00:00.000Z"
    }
  ]
}
```

## 3. Download PDF

**GET** `/api/materials/MATERIAL_ID/download` — owning teacher or enrolled student.

No body. Success returns the PDF bytes with `Content-Type: application/pdf` and attachment filename. It does **not** return JSON. The frontend must send the access token and handle a binary/blob response.

Potential errors: `400` invalid ID, `403` no classroom access, `404` material missing, `502` Cloudinary file could not be retrieved.

## 4. Update material metadata

**PATCH** `/api/materials/MATERIAL_ID` — owning teacher only.

Request (one or both fields):
```json
{
  "title": "Updated Lecture Notes",
  "description": "Revised notes for Unit 2"
}
```
Success `200`:
```json
{
  "success": true,
  "message": "Study material updated successfully.",
  "material": {
    "_id": "671234567890abcdef123456",
    "title": "Updated Lecture Notes",
    "description": "Revised notes for Unit 2",
    "classroom": "671234567890abcdef123457",
    "uploadedBy": "671234567890abcdef123458",
    "originalName": "unit-2.pdf",
    "fileSize": 245760,
    "mimeType": "application/pdf"
  }
}
```

## 5. Delete material

**DELETE** `/api/materials/MATERIAL_ID` — owning teacher only. No body.

Success `200`:
```json
{ "success": true, "message": "Study material deleted successfully." }
```
This removes the Cloudinary file and the database record. If storage deletion fails, the endpoint returns an error; verify both systems when troubleshooting.

## StudyMaterial schema

`title`, `description`, `classroom`, `uploadedBy`, `cloudinaryPublicId`, `originalName`, `fileSize`, `mimeType`, `createdAt`, `updatedAt`. `cloudinaryPublicId` is unique and required.

Browser note: use `FormData`; do not manually set the multipart `Content-Type` header because the browser needs to add its boundary.


## ML activity tracking

A successful student request to list classroom resources records `resource_list_view`; a successful student PDF download records `resource_download`. These timestamps contribute to the distinct first-90-day `active_days` metric. Teacher activity is not included.
