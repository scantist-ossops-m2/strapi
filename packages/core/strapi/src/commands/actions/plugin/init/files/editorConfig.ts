import type { TemplateFile } from '@strapi/pack-up';
import { outdent } from 'outdent';

const editorConfigFile: TemplateFile = {
  name: '.editorconfig',
  contents: outdent`
    root = true

    [*]
    indent_style = space
    indent_size = 2
    end_of_line = lf
    charset = utf-8
    trim_trailing_whitespace = true
    insert_final_newline = true
    
    [{package.json,*.yml}]
    indent_style = space
    indent_size = 2
    
    [*.md]
    trim_trailing_whitespace = false
    `,
};

export { editorConfigFile };
