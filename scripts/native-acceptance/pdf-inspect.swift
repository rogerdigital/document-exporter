import PDFKit
import AppKit

// Usage: swift pdf-inspect.swift <file.pdf> [sentinel ...]
let path = CommandLine.arguments[1]
guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
    print("open=false")
    exit(2)
}
print("pages=\(doc.pageCount)")
print("chars=\(doc.string?.count ?? 0)")
for s in CommandLine.arguments.dropFirst(2) {
    print("sentinel[\(s)]=\(doc.string?.contains(s) ?? false)")
}
if doc.pageCount > 0 {
    let mid = doc.pageCount / 2
    let first = doc.page(at: 0)?.string?.prefix(60).replacingOccurrences(of: "\n", with: " ") ?? ""
    let middle = doc.page(at: mid)?.string?.prefix(60).replacingOccurrences(of: "\n", with: " ") ?? ""
    let last = doc.page(at: doc.pageCount - 1)?.string?.prefix(60).replacingOccurrences(of: "\n", with: " ") ?? ""
    print("firstPageSample=\(first)")
    print("middlePageSample=\(middle)")
    print("lastPageSample=\(last)")
    for idx in Set([0, mid, doc.pageCount - 1]) {
        guard let page = doc.page(at: idx) else { continue }
        let rect = page.bounds(for: .mediaBox)
        let w = 900.0
        let scale = w / rect.width
        let img = page.thumbnail(of: CGSize(width: w, height: rect.height * scale), for: .mediaBox)
        if let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            let out = path + ".page\(idx).png"
            try! png.write(to: URL(fileURLWithPath: out))
            print("rendered=\(out)")
        }
    }
}
