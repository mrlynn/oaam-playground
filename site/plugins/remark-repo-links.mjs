// Links in docs/ that point at files outside it (the project READMEs, the lab
// notebooks) work on GitHub but not on the site. Rewrite them to GitHub URLs at
// build time so the markdown itself stays as it is.
import path from "node:path";

export default function remarkRepoLinks({ docsDir, repoDir, blobBase }) {
  const walk = (node, file) => {
    if (node.type === "link" && typeof node.url === "string" && !/^[a-z]+:|^#|^\//i.test(node.url) && file.path) {
      const [target, hash] = node.url.split("#");
      const abs = path.resolve(path.dirname(file.path), target);
      if (target && !abs.startsWith(docsDir + path.sep)) {
        node.url = `${blobBase}/${path.relative(repoDir, abs)}${hash ? `#${hash}` : ""}`;
      }
    }
    for (const child of node.children ?? []) walk(child, file);
  };
  return (tree, file) => walk(tree, file);
}
