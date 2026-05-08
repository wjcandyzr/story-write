import { PromptTemplateService } from './prompt-template.service';

describe('PromptTemplateService.render', () => {
  it('substitutes simple {var} placeholders', () => {
    const out = PromptTemplateService.render('Hello {name}, ch{n}', { name: 'Lin', n: 3 });
    expect(out).toBe('Hello Lin, ch3');
  });

  it('replaces missing vars with empty string', () => {
    expect(PromptTemplateService.render('a={a},b={b}', { a: 'x' })).toBe('a=x,b=');
  });

  it('treats undefined and null identically', () => {
    expect(PromptTemplateService.render('{x}', { x: undefined })).toBe('');
    expect(PromptTemplateService.render('{x}', { x: null as unknown as undefined })).toBe('');
  });

  it('leaves unknown braces in non-word form intact', () => {
    expect(PromptTemplateService.render('{ space }/{0}', { '0': 'zero' })).toBe('{ space }/zero');
  });
});
