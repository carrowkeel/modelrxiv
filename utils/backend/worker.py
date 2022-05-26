import json
import sys
import importlib

def run_params(step_module, fixed_params, variable_params, step_output=None):
	if variable_params != None:
		return [step_module.run({**fixed_params, **params}) for params in variable_params]
	else:
		return step_module.run(fixed_params, step_output=step_output)

def test(step_module):
	try:
		params = step_module.defaults()
		return {'input_params': params, 'dynamics_params': step_module.step(step_module.defaults(), False, 0) if step_module.step else {}, 'result_params': step_module.run(step_module.defaults())}
	except Exception as e:
		print(e, file=sys.stderr)
		return {'error': e}

def process_job(request):
	step_module = importlib.import_module(request['script'].replace('.py', ''))
	if 'test' in request['fixed_params']:
		return test(request['script'])
	elif not 'variable_params' in request and hasattr(step_module, 'step'):
		return {} ## Implement dynamicsStream
	elif not 'variable_params' in request:
		def step_output(step):
			sys.stdout.write(json.dumps({'type': 'dynamics', 'data': step})+'\n');
		return run_params(step_module, request['fixed_params'], None, step_output);
	else:
		return run_params(step_module, request['fixed_params'], request['variable_params'])

def main():
	for line in sys.stdin:
		message = json.loads(line)
		if message['type'] != 'job':
			continue
		result = process_job(message['request'])
		sys.stdout.write(json.dumps({'type': 'result', 'data': result})+'\n')
		sys.stdout.flush()

main()
