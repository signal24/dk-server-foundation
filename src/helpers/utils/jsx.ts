import { InjectorContext } from '@deepkit/injector';
import { ElementStruct, render } from '@deepkit/template';

import { resolve } from '../../app/resolver';

export async function jsxToHtml(jsx: ElementStruct) {
    return render(resolve(InjectorContext).getRootInjector(), jsx) as Promise<string>;
}
