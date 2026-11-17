import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { uploadAsset } from '../src/lib/storage';

async function seedAssets() {
  console.log('[Seed Assets] Generating real PDF document with pdf-lib...');

  // Create real multi-page PDF document
  const pdfDoc = await PDFDocument.create();
  const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Page 1
  const page1 = pdfDoc.addPage([600, 400]);
  const { height } = page1.getSize();

  page1.drawText('Q3 MASTER SERVICE AGREEMENT & ARCHITECTURE SPECIFICATION', {
    x: 40,
    y: height - 50,
    size: 16,
    font: helveticaFont,
    color: rgb(0.1, 0.15, 0.3),
  });

  page1.drawText('1. EXECUTIVE SUMMARY & SECURITY CONTROLS', {
    x: 40,
    y: height - 90,
    size: 12,
    font: helveticaFont,
    color: rgb(0.2, 0.2, 0.2),
  });

  page1.drawText(
    'This document is stored in a private MinIO S3 bucket and streamed via Astro SSR middleware.\nEvery byte-range request is evaluated against OpenFGA Zanzibar relationship tuples.',
    {
      x: 40,
      y: height - 130,
      size: 10,
      font: timesRomanFont,
      color: rgb(0.3, 0.3, 0.3),
      lineHeight: 14,
    }
  );

  page1.drawText('CONFIDENTIAL & RESTRICTED ACCESS', {
    x: 40,
    y: height - 200,
    size: 14,
    font: helveticaFont,
    color: rgb(0.8, 0.1, 0.1),
  });

  // Page 2
  const page2 = pdfDoc.addPage([600, 400]);
  page2.drawText('SECTION 2: FINANCIAL ALLOCATION & REBAC RELATIONSHIPS', {
    x: 40,
    y: height - 50,
    size: 14,
    font: helveticaFont,
    color: rgb(0.1, 0.15, 0.3),
  });

  page2.drawText('Document ID: pdf:q3_contract | Owner: user:alice | Storage: s3://workspace-private/q3_contract.pdf', {
    x: 40,
    y: height - 90,
    size: 10,
    font: timesRomanFont,
    color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await pdfDoc.save();
  console.log(`[Seed Assets] Real PDF document generated (${pdfBytes.length} bytes). Uploading to MinIO S3...`);

  try {
    await uploadAsset('q3_contract.pdf', Buffer.from(pdfBytes), 'application/pdf');
    console.log('[Seed Assets Success] Asset s3://workspace-private/q3_contract.pdf uploaded successfully!');
  } catch (error: any) {
    console.error('[Seed Assets Error] Failed to upload asset to MinIO S3:', error.message);
  }
}

seedAssets();
