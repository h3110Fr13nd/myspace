import os
import json
import re
import fitz # PyMuPDF

PAPERS_DIR = "temp/content/extracted_papers2/papers"
OUTPUT_JSON = "temp/content/parsed_papers.json"

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def parse_pdf(pdf_path):
    doc = fitz.open(pdf_path)
    filename = os.path.basename(pdf_path)
    
    full_text = ""
    pages_text = []
    for page in doc:
        t = page.get_text()
        pages_text.append(t)
        full_text += t + "\n"
        
    first_page = pages_text[0] if pages_text else ""
    
    # Try extracting title from first page
    lines = [l.strip() for l in first_page.split('\n') if l.strip()]
    title = lines[0] if lines else filename
    if len(title) < 5 and len(lines) > 1:
        title = lines[1]
        
    # Extract Abstract
    abstract = ""
    abs_match = re.search(r'(?i)abstract[:\s]+(.*?)(?=\n\s*(?:1\s+|I\.\s+|introduction|key\s*words|keywords))', full_text, re.DOTALL)
    if abs_match:
        abstract = clean_text(abs_match.group(1))[:1500]
    else:
        abstract = clean_text(first_page[:1000])

    return {
        "filename": filename,
        "title": clean_text(title),
        "page_count": len(doc),
        "abstract": abstract,
        "full_text": full_text
    }

def main():
    if not os.path.exists(PAPERS_DIR):
        print(f"Directory {PAPERS_DIR} not found.")
        return
        
    pdf_files = [f for f in os.listdir(PAPERS_DIR) if f.endswith(".pdf")]
    print(f"Found {len(pdf_files)} PDF papers to process.")
    
    results = []
    for pdf_file in pdf_files:
        path = os.path.join(PAPERS_DIR, pdf_file)
        try:
            data = parse_pdf(path)
            results.append(data)
            print(f"Successfully processed: {pdf_file} ({data['page_count']} pages)")
        except Exception as e:
            print(f"Error parsing {pdf_file}: {e}")
            
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        
    print(f"\nSaved {len(results)} parsed papers to {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
