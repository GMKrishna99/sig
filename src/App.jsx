import { useState, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument, rgb } from "pdf-lib";
import SignaturePad from "signature_pad";
import { v4 as uuidv4 } from "uuid";
import "./App.css";

// Set up PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

function App() {
  const [documentFile, setDocumentFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [signatureFields, setSignatureFields] = useState([]);
  const [activeField, setActiveField] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const canvasRef = useRef(null);
  const signaturePadRef = useRef(null);

  // Initialize Signature Pad
  useEffect(() => {
    if (canvasRef.current) {
      signaturePadRef.current = new SignaturePad(canvasRef.current, {
        backgroundColor: "rgba(255, 255, 255, 0)",
        penColor: "rgb(0, 0, 0)",
        minWidth: 0.5,
        maxWidth: 2.5,
        throttle: 16,
      });

      const resizeCanvas = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvasRef.current.width = canvasRef.current.offsetWidth * ratio;
        canvasRef.current.height = canvasRef.current.offsetHeight * ratio;
        canvasRef.current.getContext("2d").scale(ratio, ratio);
        signaturePadRef.current.clear();
      };

      window.addEventListener("resize", resizeCanvas);
      resizeCanvas();

      return () => {
        window.removeEventListener("resize", resizeCanvas);
      };
    }
  }, []);

  const handleDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setDocumentFile(file);
      setSignatureFields([]);
    }
  };

  const addSignatureField = () => {
    const newField = {
      id: uuidv4(),
      x: 50,
      y: 50,
      width: 200,
      height: 80,
      signatureData: null,
      pageNumber,
    };
    setSignatureFields([...signatureFields, newField]);
    setActiveField(newField.id);
  };

  const saveSignature = () => {
    if (
      !signaturePadRef.current ||
      signaturePadRef.current.isEmpty() ||
      !activeField
    )
      return;

    const signatureData = signaturePadRef.current.toDataURL("image/png");
    setSignatureFields(
      signatureFields.map((field) =>
        field.id === activeField ? { ...field, signatureData } : field
      )
    );
    signaturePadRef.current.clear();
  };

  const clearSignature = () => {
    if (signaturePadRef.current) {
      signaturePadRef.current.clear();
    }
  };

  const removeActiveField = () => {
    if (!activeField) return;
    setSignatureFields(
      signatureFields.filter((field) => field.id !== activeField)
    );
    setActiveField(null);
  };

  const handleFieldMouseDown = (e, fieldId) => {
    e.stopPropagation();
    setActiveField(fieldId);

    const startX = e.clientX;
    const startY = e.clientY;
    const fieldIndex = signatureFields.findIndex((f) => f.id === fieldId);
    const field = signatureFields[fieldIndex];
    const startFieldX = field.x;
    const startFieldY = field.y;

    const handleMouseMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const newFields = [...signatureFields];
      newFields[fieldIndex] = {
        ...newFields[fieldIndex],
        x: startFieldX + dx,
        y: startFieldY + dy,
      };
      setSignatureFields(newFields);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const downloadSignedPdf = async () => {
    if (!documentFile || signatureFields.length === 0) {
      alert("Please upload a document and add signatures first");
      return;
    }

    setIsDownloading(true);

    try {
      // 1. Read the uploaded file
      const fileArrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(documentFile);
      });

      // 2. Load the PDF
      const pdfDoc = await PDFDocument.load(fileArrayBuffer);
      const pages = pdfDoc.getPages();

      // 3. Process each signature field
      for (const field of signatureFields) {
        if (field.signatureData && field.pageNumber <= pages.length) {
          const page = pages[field.pageNumber - 1];
          const { width, height } = page.getSize();

          // Calculate scale factor (match display scale)
          const displayWidth = 600; // Same as your Page width prop
          const scale = displayWidth / width;

          // Convert signature to image
          const pngImageBytes = await fetch(field.signatureData).then((res) =>
            res.arrayBuffer()
          );

          // Embed the PNG image
          const pngImage = await pdfDoc.embedPng(pngImageBytes);

          // Calculate PDF coordinates (PDF uses bottom-left origin)
          const pdfX = field.x / scale;
          const pdfY = height - field.y / scale - field.height / scale;
          const pdfWidth = field.width / scale;
          const pdfHeight = field.height / scale;

          // Draw the signature on the PDF page
          page.drawImage(pngImage, {
            x: pdfX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight,
          });
        }
      }

      // 4. Save the modified PDF
      const pdfBytes = await pdfDoc.save();

      // 5. Trigger download
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "signed-document.pdf";
      document.body.appendChild(link);
      link.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate signed PDF. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Document Signer</h1>
        <input type="file" accept=".pdf" onChange={handleFileChange} />
      </header>

      <div className="main-content">
        <div className="document-container">
          {documentFile && (
            <Document
              file={documentFile}
              onLoadSuccess={handleDocumentLoadSuccess}
              loading="Loading PDF..."
              error="Failed to load PDF."
            >
              <Page
                pageNumber={pageNumber}
                width={600}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              >
                {signatureFields
                  .filter((field) => field.pageNumber === pageNumber)
                  .map((field) => (
                    <div
                      key={field.id}
                      className={`signature-field ${
                        activeField === field.id ? "active" : ""
                      }`}
                      style={{
                        left: `${field.x}px`,
                        top: `${field.y}px`,
                        width: `${field.width}px`,
                        height: `${field.height}px`,
                      }}
                      onMouseDown={(e) => handleFieldMouseDown(e, field.id)}
                    >
                      {field.signatureData && (
                        <img
                          src={field.signatureData}
                          alt="Signature"
                          className="signature-img"
                        />
                      )}
                    </div>
                  ))}
              </Page>
            </Document>
          )}
          {!documentFile && (
            <div className="upload-prompt">
              <p>Upload a PDF document to begin</p>
            </div>
          )}
        </div>

        <div className="tools-panel">
          <button onClick={addSignatureField} className="tool-btn">
            Add Signature Field
          </button>

          {activeField && (
            <button onClick={removeActiveField} className="tool-btn danger">
              Remove Field
            </button>
          )}

          <div className="signature-pad-container">
            <canvas ref={canvasRef} className="signature-canvas"></canvas>
            <div className="signature-actions">
              <button onClick={clearSignature} className="tool-btn">
                Clear
              </button>
              <button onClick={saveSignature} className="tool-btn primary">
                Save Signature
              </button>
            </div>
          </div>

          <button
            onClick={downloadSignedPdf}
            className="tool-btn download-btn"
            disabled={
              !documentFile || signatureFields.length === 0 || isDownloading
            }
          >
            {isDownloading ? "Downloading..." : "Download Signed PDF"}
          </button>

          {numPages && (
            <div className="page-controls">
              <button
                onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
                disabled={pageNumber <= 1}
              >
                Previous
              </button>
              <span>
                Page {pageNumber} of {numPages}
              </span>
              <button
                onClick={() =>
                  setPageNumber(Math.min(numPages, pageNumber + 1))
                }
                disabled={pageNumber >= numPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
