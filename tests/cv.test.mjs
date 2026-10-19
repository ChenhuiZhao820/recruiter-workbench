import test from "node:test";
import assert from "node:assert/strict";
import { CONTACTS_CHECK, CONTACTS_NOTICE, MAX_CLIENT_CV_BYTES, checkCvUpload, cvDisposition, cvFileName, missingCvMessage } from "../lib/cv-core.mjs";

// The CV a client sees in place of the confirmed facts: what is accepted, the
// contact-details check no upload can skip, and the header it is sent with.

const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF");

test("a CV is a PDF of up to 4 MB, and never without the contact-details check", () => {
  assert.deepEqual(checkCvUpload({ name: "Jane Doe CV.pdf", size: pdf.length, bytes: pdf, contactsChecked: true }), { fileName: "Jane Doe CV.pdf" });
  assert.match(checkCvUpload({ name: "cv.pdf", size: pdf.length, bytes: pdf, contactsChecked: false }).error, /contact details/);
  assert.match(checkCvUpload({ name: "cv.pdf", size: pdf.length, bytes: pdf }).error, /contact details/);
  assert.match(checkCvUpload({ name: "cv.docx", size: 4, bytes: new TextEncoder().encode("PK\u0003\u0004"), contactsChecked: true }).error, /must be a PDF/);
  assert.match(checkCvUpload({ name: "cv.pdf", size: 0, bytes: new Uint8Array(), contactsChecked: true }).error, /Choose the CV/);
  const big = new Uint8Array(MAX_CLIENT_CV_BYTES + 1);
  big.set(pdf.slice(0, 5));
  assert.match(checkCvUpload({ name: "cv.pdf", size: big.length, bytes: big, contactsChecked: true }).error, /larger than 4 MB/);
  // The notice says the client gets the file as it is; the tick says the recruiter dealt with it.
  assert.match(CONTACTS_NOTICE, /exactly as it is/);
  assert.match(CONTACTS_CHECK, /contact details/);
});

test("file names lose folders and anything that could break a header, and end in .pdf", () => {
  assert.equal(cvFileName("C:\\Users\\me\\Desktop\\Jane CV.PDF"), "Jane CV.pdf");
  assert.equal(cvFileName("../../etc/passwd"), "passwd.pdf");
  assert.equal(cvFileName('a"b<c>|d?.pdf'), "abcd.pdf");
  assert.equal(cvFileName(""), "CV.pdf");
  assert.equal(cvFileName("x".repeat(300)).length, 120);
  const header = cvDisposition('Jane "Doe" 简历.pdf');
  assert.match(header, /^inline; filename="Jane Doe __\.pdf"; filename\*=UTF-8''Jane%20Doe%20%E7%AE%80%E5%8E%86\.pdf$/);
  assert.doesNotMatch(cvDisposition("a\r\nSet-Cookie: x.pdf"), /[\r\n]/);
});

test("the warning names who has no CV and says the client sees the confirmed details instead", () => {
  assert.equal(
    missingCvMessage(["Daniel Okafor"], "Basanite"),
    "Basanite will not see a CV for Daniel Okafor, only the details you confirmed. Upload it as soon as you have it: the client's page shows a CV the moment it is uploaded.",
  );
  assert.match(missingCvMessage(["A One", "B Two", "C Three"], ""), /^The client will not see a CV for A One, B Two and C Three, .* Upload them as soon as you have them/);
});
