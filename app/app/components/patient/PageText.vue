<script setup lang="ts">
// The page transcription in the "Přepis stránky" tab (pageTextHtml() in the template): headings and tables kept, the
// cited passage in <mark>, "ověřit" tokens dotted, transcriber notes dimmed, unreadable characters as "?". The text is
// rendered as text nodes from the segmentation in packages/domain, never as HTML, so a transcription cannot inject
// markup.
import { h, type VNodeChild } from "vue";
import { useFluent } from "fluent-vue";
import type { Block, Piece } from "@codebridge/domain/page-text";
import type { Verify } from "@codebridge/domain/quote-match";

const props = defineProps<{ blocks: Block[]; verifyTitle: (v: Verify) => string }>();
const { $t } = useFluent();

// The nesting order is the template's (mark outermost, then the note, then the verify token), so the CSS applies the
// same way.
function piece(p: Piece): VNodeChild {
  let n: VNodeChild = p.unreadable ? h("span", { class: "unr", title: $t("patient-src-unreadable", { n: p.text.length }) }, "?") : p.text;
  if (p.verify) n = h("span", { class: "vf", title: props.verifyTitle(p.verify) }, [n]);
  if (p.note) n = h("span", { class: "vm", title: $t("patient-src-transcriber-note") }, [n]);
  if (p.hit) n = h("mark", p.firstHit ? { id: "hit" } : {}, [n]);
  return n;
}
const Pieces = (pp: { ps: Piece[] }) => pp.ps.map(piece);
</script>

<template>
  <div class="ptext" lang="cs">
    <template v-for="(b, i) in blocks" :key="i">
      <div v-if="b.kind === 'table'" class="scroll">
        <table class="mdt">
          <tbody>
            <tr v-for="(r, j) in b.rows" :key="j">
              <td v-for="(c, k) in r" :key="k"><Pieces :ps="c" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else :class="b.heading ? 'ln mdh' : 'ln'"><Pieces :ps="b.pieces" /></div>
    </template>
  </div>
</template>
