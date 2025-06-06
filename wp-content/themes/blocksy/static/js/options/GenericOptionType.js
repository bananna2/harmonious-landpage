import {
	createElement,
	Fragment,
	Component,
	useState,
	useRef,
	useEffect,
	RawHTML,
} from '@wordpress/element'
import { BaseControl } from '@wordpress/components'
import classnames from 'classnames'
import ResponsiveControls, {
	maybePromoteScalarValueIntoResponsive,
	isOptionEnabledFor,
	getValueForDevice,
	isOptionResponsiveFor,
} from '../customizer/components/responsive-controls'
import deepEqual from 'deep-equal'
import { normalizeCondition, matchValuesWithCondition } from 'match-conditions'
import { __ } from 'ct-i18n'
import { getOptionLabelFor } from './helpers/get-label'
import ctEvents from 'ct-events'

import { getCurrentDevice } from '../customizer/components/useDeviceManager'

import { mutateResponsiveValueWithScalar } from './helpers/mutate-responsive-value'

const CORE_OPTIONS_CONTEXT = require.context('./options/', false, /\.js$/)
CORE_OPTIONS_CONTEXT.keys().forEach(CORE_OPTIONS_CONTEXT)

const hasCoreOptionModifier = (type) => {
	let index = CORE_OPTIONS_CONTEXT.keys()
		.map((module) => module.replace(/^\.\//, '').replace(/\.js$/, ''))
		.indexOf(type)

	return index > -1 && CORE_OPTIONS_CONTEXT.keys()[index]
}

export const capitalizeFirstLetter = (str) => {
	str = str == null ? '' : String(str)
	return str.charAt(0).toUpperCase() + str.slice(1)
}

const DefaultOptionComponent = ({ option }) => {
	return <div>Unimplemented option: {option.type}</div>
}

export const getOptionFor = (option) => {
	const dynamicOptionTypes = {}
	ctEvents.trigger('blocksy:options:register', dynamicOptionTypes)

	if (hasCoreOptionModifier(option.type)) {
		return CORE_OPTIONS_CONTEXT(hasCoreOptionModifier(option.type)).default
	}

	if (dynamicOptionTypes[option.type]) {
		return dynamicOptionTypes[option.type]
	}

	return DefaultOptionComponent
}

export const optionWithDefault = ({ option, value }) =>
	value === undefined ? option.value : value

const GenericOptionType = ({
	option,
	value,
	values,
	onChange,
	onChangeFor,
	hasRevertButton,
	id,
	purpose,
}) => {
	const [liftedOptionState, setLiftedOptionState] = useState(null)

	let maybeGutenbergDevice = null

	const childComponentRef = useRef(null)

	if (wp.data && wp.data.useSelect) {
		maybeGutenbergDevice = wp.data.useSelect((select) => {
			if (!select('core/edit-post')) {
				return null
			}

			return getCurrentDevice(select)
		})
	}

	const getInitialDevice = () => {
		return getCurrentDevice()
	}

	const [device, setInnerDevice] = useState(getInitialDevice())

	const listener = () => {
		setInnerDevice(getInitialDevice())
	}

	const ctEventsListener = ({ device }) => {
		setInnerDevice(device)
	}

	const setDevice = (device) => {
		ctEvents.trigger('ct:options:device:update', { device })
		setInnerDevice(device)

		if (wp.customize && wp.customize.previewedDevice) {
			wp.customize.previewedDevice.set(device)
		}

		if (
			wp.data &&
			wp.data.dispatch &&
			wp.data.dispatch('core/edit-post') &&
			wp.data.dispatch('core/edit-post')
				.__experimentalSetPreviewDeviceType
		) {
			wp.data
				.dispatch('core/edit-post')
				.__experimentalSetPreviewDeviceType(
					device.replace(/\w/, (c) => c.toUpperCase())
				)
		}
	}

	useEffect(() => {
		if (maybeGutenbergDevice) {
			setInnerDevice(maybeGutenbergDevice.toLowerCase())
		}
	}, [maybeGutenbergDevice])

	useEffect(() => {
		if (option.type !== 'ct-typography') {
			if (!isOptionResponsiveFor(option) && !option.markAsAutoFor) {
				return
			}
		}

		if (wp.customize && wp.customize.previewedDevice) {
			setTimeout(() => wp.customize.previewedDevice.bind(listener), 1000)
		}

		ctEvents.on('ct:options:device:update', ctEventsListener)

		setInnerDevice(getInitialDevice())

		return () => {
			if (option.type !== 'ct-typography') {
				if (!isOptionResponsiveFor(option)) {
					return
				}
			}

			if (wp.customize && wp.customize.previewedDevice) {
				wp.customize.previewedDevice.unbind(listener)
			}

			ctEvents.off('ct:options:device:update', ctEventsListener)
		}
	}, [])

	let OptionComponent = getOptionFor(option)
	let BeforeOptionContent = { content: null, option }

	ctEvents.trigger('blocksy:options:before-option', BeforeOptionContent)

	const globalResponsiveValue = maybePromoteScalarValueIntoResponsive(
		optionWithDefault({ value, option }),
		isOptionResponsiveFor(option)
	)

	const valueWithResponsive = isOptionResponsiveFor(option, {
		ignoreHidden: true,
	})
		? getValueForDevice({ option, value: globalResponsiveValue, device })
		: globalResponsiveValue

	const onChangeWithMobileBridge = (value) => {
		if (option.triggerRefreshOnChange) {
			wp.customize &&
				wp.customize.previewer &&
				wp.customize.previewer.refresh()
		}

		if (
			option.switchDeviceOnChange &&
			wp.customize &&
			wp.customize.previewedDevice() !== option.switchDeviceOnChange
		) {
			wp.customize.previewedDevice.set(option.switchDeviceOnChange)
		}

		if (
			option.sync &&
			(Object.keys(option.sync).length > 0 ||
				Array.isArray(option.sync)) &&
			wp.customize &&
			wp.customize.previewer
		) {
			let ids = (
				Array.isArray(option.sync) ? option.sync : [option.sync]
			).map((sync) => sync.id || option.id)

			if (ids.length > 1) {
				const maybeMainSync = (
					Array.isArray(option.sync) ? option.sync : [option.sync]
				).find(({ id }) => (id || option.id) === option.id)

				if (maybeMainSync) {
					ids = [option.id]
				}
			}

			wp.customize.previewer.send('ct:sync:refresh_partial', {
				id: ids,
				option,
				shouldSkip: !!option.sync.shouldSkip,
			})
		}

		onChange(value)
	}

	const onChangeWithResponsiveBridge = (scalarValue) => {
		const responsiveValue = maybePromoteScalarValueIntoResponsive(
			optionWithDefault({ value, option }),
			isOptionResponsiveFor(option)
		)

		let newValue = scalarValue

		if (isOptionResponsiveFor(option, { ignoreHidden: true })) {
			const isTabletSkipping =
				device === 'tablet' &&
				isOptionEnabledFor('tablet', option.responsive) === 'skip'

			newValue = mutateResponsiveValueWithScalar({
				scalarValue,
				responsiveValue,
				device,

				...(isTabletSkipping
					? {
							devices: ['desktop', 'mobile'],
					  }
					: {}),
			})
		}

		onChangeWithMobileBridge(newValue)
	}

	/**
	 * Handle transparent components
	 */
	if (!OptionComponent) {
		return <div>Unimplemented option: {option.type}</div>
	}

	let renderingConfig = { design: true, label: true, wrapperAttr: {} }
	let LabelToolbar = () => null
	let OptionMetaWrapper = null
	let ControlEnd = () => null
	let sectionClassName = () => ({})

	renderingConfig = {
		...renderingConfig,
		...(OptionComponent.renderingConfig || {}),
	}

	if (option.design) {
		renderingConfig.design = option.design
	}

	if (typeof renderingConfig.design === 'function') {
		renderingConfig.design = renderingConfig.design({
			option,
			value: valueWithResponsive,
		})
	}

	if (OptionComponent.LabelToolbar) {
		LabelToolbar = OptionComponent.LabelToolbar
	}

	if (OptionComponent.ControlEnd) {
		ControlEnd = OptionComponent.ControlEnd
	}

	if (OptionComponent.MetaWrapper) {
		OptionMetaWrapper = OptionComponent.MetaWrapper
	}

	if (OptionComponent.sectionClassName) {
		sectionClassName = OptionComponent.sectionClassName
	}

	let supportedPurposes = ['default']

	if (OptionComponent.supportedPurposes) {
		supportedPurposes = OptionComponent.supportedPurposes
	}

	let actualPurpose = purpose

	if (option.purpose && supportedPurposes.indexOf(option.purpose) !== -1) {
		actualPurpose = option.purpose
	}

	let maybeLabel = getOptionLabelFor({
		id,
		option,
		values,
		renderingConfig,
	})

	let OptionComponentWithoutDesign = (
		<Fragment>
			{BeforeOptionContent && BeforeOptionContent.content}
			<OptionComponent
				key={id}
				{...{
					...(option.type === 'ct-slider'
						? {
								ref: (c) => {
									if (c) {
										childComponentRef.current = c
									}
								},
						  }
						: {}),
					liftedOptionStateDescriptor: {
						liftedOptionState,
						setLiftedOptionState,
					},
					option: {
						...option,
						value: isOptionResponsiveFor(option, {
							ignoreHidden: true,
						})
							? getValueForDevice({
									device,
									option,
									value: maybePromoteScalarValueIntoResponsive(
										option.value || ''
									),
							  })
							: maybePromoteScalarValueIntoResponsive(
									option.value || '',
									isOptionResponsiveFor(option)
							  ),
					},
					value: valueWithResponsive,
					id,
					values,
					onChangeFor,
					device,
					onChange: onChangeWithResponsiveBridge,
					purpose: actualPurpose,
					maybeLabel,
				}}
			/>
		</Fragment>
	)

	if (!renderingConfig.design || renderingConfig.design === 'none') {
		return OptionComponentWithoutDesign
	}

	const RevertButton = () => {
		let computeOptionValue = renderingConfig.computeOptionValue

		if (!computeOptionValue) {
			computeOptionValue = (o, { option, values }) => o
		}

		if (option.type === 'ct-panel' && !option.switch) {
			return null
		}

		return (
			((option.type !== 'ct-image-picker' &&
				option.type !== 'ct-layers' &&
				hasRevertButton &&
				!option.disableRevertButton) ||
				option.forcedRevertButton) && (
				<button
					type="button"
					disabled={deepEqual(
						Object.keys(option).indexOf('revertDefaultValue') > -1
							? option.revertDefaultValue
							: computeOptionValue(option.value, {
									option,
									values,
							  }),

						// Important: all implementations should add handling
						// for undefined and skip revert in that case.
						renderingConfig.getValueForRevert
							? renderingConfig.getValueForRevert({
									value,
									option,
									values,
									device,
							  })
							: optionWithDefault({
									value,
									option,
							  })
					)}
					className="ct-revert"
					onClick={(e) => {
						e.stopPropagation()

						let revertValue = option.value

						if (
							Object.keys(option).indexOf('revertDefaultValue') >
							-1
						) {
							revertValue = option.revertDefaultValue
						}

						if (childComponentRef && childComponentRef.current) {
							childComponentRef.current.handleOptionRevert()
						}

						setLiftedOptionState(null)

						if (renderingConfig.performRevert) {
							renderingConfig.performRevert({
								onChangeFor,
								option,
							})
						}

						onChangeWithMobileBridge(revertValue)
					}}>
					<svg fill="currentColor" viewBox="0 0 35 35">
						<path d="M17.5,26L17.5,26C12.8,26,9,22.2,9,17.5v0C9,12.8,12.8,9,17.5,9h0c4.7,0,8.5,3.8,8.5,8.5v0C26,22.2,22.2,26,17.5,26z" />
						<polygon points="34.5,30.2 21.7,17.5 34.5,4.8 30.2,0.5 17.5,13.3 4.8,0.5 0.5,4.8 13.3,17.5 0.5,30.2 4.8,34.5 17.5,21.7 30.2,34.5 " />
					</svg>
				</button>
			)
		)
	}

	let maybeDesc =
		Object.keys(option).indexOf('desc') === -1 ? false : option.desc

	let maybeLink =
		Object.keys(option).indexOf('link') === -1 ? false : option.link || ' '

	const actualDesignType =
		typeof renderingConfig.design === 'boolean'
			? 'block'
			: renderingConfig.design

	if (purpose === 'taxonomy') {
		return (
			<tr className="form-field ct-term-screen-edit">
				<th scope="row">
					{maybeLabel && (
						<label>
							{maybeLabel} <RevertButton />
						</label>
					)}
				</th>
				<td>
					{OptionComponentWithoutDesign}
					{maybeDesc && <p className="description">{maybeDesc}</p>}
				</td>
			</tr>
		)
	}

	if (purpose === 'gutenberg') {
		if (
			!supportedPurposes.includes('gutenberg') ||
			actualPurpose !== 'gutenberg'
		) {
			return (
				<BaseControl
					label={maybeLabel}
					className={classnames('ct-control-gutenberg', {
						[`ct-divider-${option.divider}`]: !!option.divider,
					})}
					help={maybeDesc ? <RawHTML>{maybeDesc}</RawHTML> : ''}>
					{OptionComponentWithoutDesign}
				</BaseControl>
			)
		}

		return (
			<BaseControl
				__nextHasNoMarginBottom
				className={classnames('ct-control-gutenberg', {
					[`ct-divider-${option.divider}`]: !!option.divider,
				})}>
				{OptionComponentWithoutDesign}
			</BaseControl>
		)
	}

	if (renderingConfig.design === 'compact') {
		return (
			<section {...(option.sectionAttr || {})}>
				{maybeLabel && <label>{maybeLabel}</label>}

				{((isOptionResponsiveFor(option) &&
					isOptionEnabledFor(device, option.responsive)) ||
					!isOptionResponsiveFor(option)) &&
					OptionComponentWithoutDesign}
				{maybeLink && (
					<a
						dangerouslySetInnerHTML={{
							__html: maybeLink,
						}}
						{...(option.linkAttr || {})}
					/>
				)}
			</section>
		)
	}

	const getActualOption = ({
		wrapperAttr: { className, ...additionalWrapperAttr } = {},
		...props
	} = {}) => {
		const { className: optionClassName, ...optionAdditionalWrapperAttr } =
			option.wrapperAttr || {}

		const { class: sectionClassNameStr, ...sectionAttr } =
			option.sectionAttr || {}

		return (
			<Fragment>
				<div
					className={classnames(
						'ct-control',
						className,
						optionClassName,
						{}
					)}
					data-design={actualDesignType}
					{...(option.divider
						? { 'data-divider': option.divider }
						: {})}
					{...{
						...((isOptionResponsiveFor(option) &&
							!isOptionEnabledFor(device, option.responsive)) ||
						option.state === 'disabled'
							? { 'data-state': 'disabled' }
							: {}),
					}}
					{...{
						...optionAdditionalWrapperAttr,
						...additionalWrapperAttr,
					}}>
					<header {...(!maybeLabel ? { 'data-label': 'no' } : {})}>
						{maybeLabel && <label>{maybeLabel}</label>}
						<RevertButton />

						<LabelToolbar
							{...{
								option,
								value: valueWithResponsive,
								id,
								onChange: onChangeWithResponsiveBridge,
							}}
						/>

						{isOptionResponsiveFor(option, {
							ignoreHidden: true,
						}) &&
							actualDesignType.indexOf('block') > -1 &&
							!option.skipResponsiveControls && (
								<ResponsiveControls
									device={device}
									responsiveDescriptor={option.responsive}
									setDevice={setDevice}
								/>
							)}
					</header>

					{isOptionResponsiveFor(option) &&
						!isOptionEnabledFor(device, option.responsive) && (
							<div className="ct-disabled-notification">
								{option.disabledDeviceMessage ||
									__(
										"Option can't be edited for current device",
										'blocksy'
									)}
							</div>
						)}

					{((isOptionResponsiveFor(option) &&
						isOptionEnabledFor(device, option.responsive)) ||
						!isOptionResponsiveFor(option)) && (
						<Fragment>
							<section
								{...sectionAttr}
								className={classnames(
									{
										'ct-responsive-container':
											isOptionResponsiveFor(option, {
												ignoreHidden: true,
											}) && actualDesignType === 'inline',
									},
									sectionClassName({
										design: actualDesignType,
										option,
									}),
									sectionClassNameStr || ''
								)}>
								{isOptionResponsiveFor(option, {
									ignoreHidden: true,
								}) &&
									actualDesignType === 'inline' && (
										<ResponsiveControls
											device={device}
											responsiveDescriptor={
												option.responsive
											}
											setDevice={setDevice}
										/>
									)}
								{OptionComponentWithoutDesign}

								{maybeLink && (
									<a
										dangerouslySetInnerHTML={{
											__html: maybeLink,
										}}
										{...(option.linkAttr || {})}
									/>
								)}
							</section>

							<ControlEnd />

							{maybeDesc && (
								<div
									dangerouslySetInnerHTML={{
										__html: maybeDesc,
									}}
									className="ct-option-description"
								/>
							)}
						</Fragment>
					)}
				</div>
			</Fragment>
		)
	}

	return OptionMetaWrapper ? (
		<OptionMetaWrapper
			id={id}
			option={option}
			value={valueWithResponsive}
			onChangeFor={onChangeFor}
			values={values}
			getActualOption={getActualOption}
		/>
	) : (
		getActualOption()
	)
}

export default GenericOptionType
