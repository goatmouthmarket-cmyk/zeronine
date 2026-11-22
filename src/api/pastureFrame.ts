/** Inline the one pasture renderer without coupling startup to its cache version. */
export function inlinePastureRenderer(html: string, renderer: string): string {
  const tags = html.match(/<script\b[^>]*\bsrc=(["'])\/trading-room-core\.js(?:\?[^"']*)?\1[^>]*>\s*<\/script>/gi);
  if (!tags || tags.length !== 1) throw new Error('Expected exactly one pasture renderer script tag');
  if (/<\/script/i.test(renderer)) throw new Error('Pasture renderer contains an inline script terminator');
  return html.replace(tags[0], () => '<script>' + renderer + '</script>');
}
