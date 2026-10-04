import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'

const p = deepseekProvider()
console.log('provider.id =', p.id)
console.log('baseUrl =', p.baseUrl)
const models = p.getModels()
console.log('models count =', models.length)
console.log('model[0] keys =', Object.keys(models[0]).join(', '))
console.log('model[0] =', JSON.stringify(models[0], null, 2).slice(0, 900))
