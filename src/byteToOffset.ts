const codeByteOffsetCache = {
  byte: 0,
  offset: 0,
};

export default (
  codeContent: string,
  editInfo: { length: number; offset: number }
) => {
  const codeBuffer = new Buffer(codeContent);
  // encoding position cache
  let offset = editInfo.offset;
  let length = editInfo.length;

  if (offset >= codeByteOffsetCache.byte) {
    editInfo.offset =
      codeByteOffsetCache.offset +
      codeBuffer.slice(codeByteOffsetCache.byte, offset).toString("utf8")
        .length;
    codeByteOffsetCache.byte = offset;
    codeByteOffsetCache.offset = editInfo.offset;
  } else {
    editInfo.offset = codeBuffer.slice(0, offset).toString("utf8").length;
    codeByteOffsetCache.byte = offset;
    codeByteOffsetCache.offset = editInfo.offset;
  }

  editInfo.length = codeBuffer
    .slice(offset, offset + length)
    .toString("utf8").length;

  return editInfo;
};
