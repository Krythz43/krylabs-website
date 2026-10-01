// Markdown images that stand alone in a paragraph become framed figures. The image's
// title, `![alt](src "Caption")`, becomes the visible caption; the alt text stays the
// description for screen readers. Runs before Astro's own image pass, which still
// finds the <img> inside and optimises it as usual.
const isBlank = (n) => n.type === 'text' && !n.value.trim();

export default function rehypeFigures() {
  const walk = (node) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type !== 'element' || child.tagName !== 'p') {
        walk(child);
        return child;
      }
      const kids = child.children.filter((n) => !isBlank(n));
      const img = kids.length === 1 && kids[0].type === 'element' && kids[0].tagName === 'img' ? kids[0] : null;
      if (!img) return child;
      const caption = img.properties.title;
      delete img.properties.title;
      const children = [{ type: 'element', tagName: 'div', properties: { className: ['figure__frame'] }, children: [img] }];
      if (caption) children.push({ type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: String(caption) }] });
      return { type: 'element', tagName: 'figure', properties: {}, children };
    });
  };
  return (tree) => walk(tree);
}
